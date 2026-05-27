# "The operation timed out." 발생 원인 진단 보고서

- **작성일**: 2026-05-27
- **대상 서비스**: `OpenAIOAuthProxy` (NSSM, 포트 10531)
- **현상**: 클라이언트(OMO/OpenCode)에서 간헐적으로 "The operation timed out." 메시지가 표시됨. **재시도하면 정상 응답**.
- **결론**: 토큰 만료 문제는 아님. 업스트림 또는 네트워크의 간헐적 지연이 클라이언트 측 `AbortSignal.timeout`을 발화시킨 결과이며, 프록시는 그 abort 신호를 그대로 업스트림 fetch에 전달하기 때문에 native fetch가 `DOMException(TimeoutError)`로 reject되어 unhandled rejection 형태로 stderr에 raw 덤프가 찍힌다.

---

## 1. 관찰된 증거

### 1.1 현재 stderr.log (742 bytes, 2026-05-27 14:29:08)

```
DOMException {
  stack: "",
  code: 23,
  name: "TimeoutError",
  message: "The operation timed out.",
  ...
}
```

특징:

- **`stack: ""`** → JS 코드에서 `throw`된 것이 아니라 native(C++) 레이어에서 만들어진 객체.
- **`code: 23` (TIMEOUT_ERR)** + **`name: "TimeoutError"`** → `AbortSignal.timeout(ms)`이 발화시키는 표준 `DOMException`.
- **`[proxy] Stream read error:` prefix가 없음** → [`writeWebResponse`](file:///C:/NEW%20PRG/openai-oauth/packages/openai-oauth/src/shared.ts#L271-L320)의 catch 경로(라인 307-311)도 아니고, [`chat-stream.ts`의 `closeWithError`](file:///C:/NEW%20PRG/openai-oauth/packages/openai-oauth/src/chat-stream.ts#L213-L237) 경로도 아니다.
- 결과: **어디선가 await chain을 빠져나간 promise가 unhandled rejection으로 흘러갔고, Bun 런타임이 객체를 그대로 inspect 출력**한 것.

### 1.2 과거 71B stderr 로그 (2026-04-29 ~ 2026-05-27, 약 2분 8초 간격 반복)

raw 바이트 디코드 결과:

```
Provided authentication token is expired. Please try signing in again.
```

이는 ChatGPT 백엔드가 만료된 access token으로 호출됐을 때 401과 함께 돌려주는 본문이다. **현재 timeout 이슈와는 직접 관련 없는 과거 이력**이며, 프록시 stderr에 한 줄씩 찍혔던 별개의 사건이다 (재시도 시 정상 동작 = 현재 토큰은 살아 있음).

### 1.3 stdout.log (538 bytes, 2026-05-27 10:05:00)

서비스 시작 시 정상 startup 메시지(`OpenAI-compatible endpoint ready at...` + 모델 리스트)만 있음. 모델 디스커버리는 통과 = 시작 시점에 토큰 정상.

### 1.4 NSSM 설정

- 서비스 상태: `RUNNING`, `START_TYPE: AUTO_START (DELAYED)`
- `BINARY_PATH_NAME: C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe`
- 짧은 stderr 파일이 다수 회전돼 있음 → NSSM의 `AppRotateFiles=1` + `AppRotateBytes` 또는 `AppRotateSeconds`가 켜져 있어서 stderr write마다 또는 임계값마다 파일이 회전되는 환경. 프록시 자체의 비정상 종료/재시작은 아님.

---

## 2. 코드 경로 분석

### 2.1 timeout signal이 어떻게 native fetch까지 도달하는가

1. 클라이언트(OMO/OpenCode)가 `/v1/chat/completions` 또는 `/v1/responses`로 요청. 클라이언트 측 SDK가 자체 `AbortSignal.timeout(N초)`를 request에 부착.
2. 프록시 [`server.ts:197`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/server.ts#L197)의 `toWebRequest`가 Node `IncomingMessage`를 표준 `Request`로 변환. 이때 클라이언트 abort 신호는 `request.signal`로 보존된다.
3. [`chat-stream.ts`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/chat-stream.ts)가 Vercel AI SDK의 `streamText`를 호출 → 내부적으로 [`provider.ts`의 `oauthFetch`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth-provider/src/provider.ts#L370) 호출.
4. [`transport.ts:345-350`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth-core/src/transport.ts#L345-L350)에서 업스트림 `chatgpt.com/backend-api/codex/responses` 호출 시 `signal: request.signal ?? undefined`로 **클라이언트 abort 신호를 그대로 통과시킴**.
5. 업스트림 응답이 오기 전에 클라이언트 timeout이 발화하면 native fetch가 `DOMException(TimeoutError, code 23)`으로 reject. 이 시점에서 SDK 내부 stream peek(`iterator.next()`) 또는 stream pump 단계의 어느 promise가 캐치되지 못하고 unhandled rejection이 됨.

### 2.2 왜 catch가 안 되는가 (가설)

`captureResponsesState`([transport.ts:291-297](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth-core/src/transport.ts#L291-L297))는 `response.body.tee()`로 본문을 둘로 나눠 한쪽은 `collectCompletedResponseFromSse`로 백그라운드 캡처한다. **여기에 `.catch(() => undefined)`가 있어 이 경로는 안전**.

문제는 별도 경로에 있을 가능성이 높다:

- 업스트림 fetch가 시작되어 헤더는 받았지만 본문 전송 중 abort된 경우, AI SDK 내부의 retry 로직이 첫 시도 abort 후 다음 retry를 spawn하면서 **첫 시도의 reader read promise가 await되지 않은 채 남는 케이스**.
- 또는 [`writeWebResponse`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/shared.ts#L271-L320)에서 `response.writableEnded`로 break한 뒤 `reader.releaseLock()` 시점에 reader가 진행 중인 read promise가 abort로 reject되어 unhandled가 되는 케이스.

두 케이스 모두 prefix 없는 raw 덤프 형태와 일치한다.

### 2.3 71B "token expired" 로그와의 관계

별개 이슈로 같은 시기에 발생했을 가능성. 71B 로그는 [`shared.ts:309`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/shared.ts#L307-L311)의 `[proxy] Stream read error:` 핸들러를 거치지 않고 단독 한 줄로 찍혔으므로, **AI SDK 내부에서 `console.error` 또는 reject된 error 값의 `.message` 만 출력된 unhandled rejection**으로 추정. 이 역시 raw DOMException 케이스와 동일한 누수 패턴이다.

---

## 3. 원인 후보 (우선순위)

| # | 가설 | 근거 | 권장 조치 |
|---|---|---|---|
| 1 | 클라이언트 측 timeout이 업스트림 SSE 응답 지연(특히 reasoning 모델의 첫 토큰까지의 TTFB)보다 짧음 | `gpt-5.5` 등 reasoning effort high/xhigh 모델은 첫 토큰까지 수십 초 걸림. 재시도 성공 = transient 지연 | OMO/OpenCode 클라이언트의 request timeout을 늘리거나, 프록시에서 클라이언트 signal을 업스트림에 forward하지 않는 옵션을 추가 |
| 2 | Cloudflare/CF NEL 측 transient 5xx 또는 네트워크 RST | 71B 로그 중 `service_unavailable_error` / `server_is_overloaded` 사례 존재 | 클라이언트 retry 정책으로 흡수 (이미 동작 중) |
| 3 | 프록시 unhandled rejection 미수렴 | raw `DOMException` 덤프 형태 (stack 없음, prefix 없음) | `process.on("unhandledRejection", ...)` 핸들러 추가하여 신호 정리 |

---

## 4. 권장 조치

### 4.1 즉시 (운영)

- **현재는 재시도로 자체 복구 가능**. 추가 작업 없이도 사용에 지장 없음.
- 토큰 회전이나 서비스 재시작은 **불필요**.

### 4.2 단기 개선 (코드)

(사용자 승인 후 적용)

#### A. unhandled rejection 핸들러 추가

[cli-app.ts](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/cli-app.ts) 의 SIGTERM 핸들러 위에 다음을 추가:

```typescript
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  console.error(`[proxy] unhandled rejection: ${msg}`)
})
```

효과: stderr에 stack 없는 raw `DOMException` 덤프 대신 `[proxy] unhandled rejection: The operation timed out.` 한 줄로 정리됨. 운영 신호 잡음 감소.

#### B. 클라이언트 abort 신호 forward 정책 검토

[transport.ts:349](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth-core/src/transport.ts#L349)의 `signal: request.signal ?? undefined`를 옵션으로 만들어, 프록시 운영자가 "클라이언트가 일찍 timeout 걸어도 업스트림 호출은 끝까지 진행 (응답은 끊긴 클라이언트로 가지 않음)" 정책을 선택할 수 있게 함. 다만 long-running 요청을 자원 낭비 없이 취소할 수 없으니 **기본값은 현재 동작 유지**하고, 옵션 플래그로만 노출하는 것이 안전.

### 4.3 장기 (관측성)

- 매 요청마다 `requestId` + 업스트림 latency를 stdout에 emit하도록 [`logging.ts`](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/logging.ts) 출력 포맷을 정리하면, "어떤 모델/effort에서 클라이언트 timeout 한계에 근접하는지" 추세 분석이 가능.

---

## 5. 검증 절차

조치 적용 후 확인:

```powershell
# 단일 stderr 모니터
Get-Content C:\Logs\OpenAIOAuthProxy\stderr.log -Wait -Tail 0

# 재현: 클라이언트에서 reasoning effort 높은 모델로 짧은 timeout 설정 후 호출
# 기대: stderr에 [proxy] unhandled rejection: The operation timed out. 한 줄
#       (raw DOMException 덤프가 아닌 형태)
```

만약 71B 짧은 로그가 다시 쌓이기 시작하면 그때는 토큰 만료 이슈로 분리해서 처리.

---

## 6. 참고

- [packages/openai-oauth-core/src/transport.ts](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth-core/src/transport.ts) - 업스트림 fetch 및 signal 통과 지점
- [packages/openai-oauth/src/shared.ts](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/shared.ts) - `writeWebResponse` stream pump
- [packages/openai-oauth/src/chat-stream.ts](file:///C:/NEW PRG/openai-oauth/packages/openai-oauth/src/chat-stream.ts) - chat completion stream peek/error classify
- [docs/OPERATIONS.md](file:///C:/NEW PRG/openai-oauth/docs/OPERATIONS.md) - 토큰 회전/서비스 운영 절차 (이번 건과 직접 무관)
