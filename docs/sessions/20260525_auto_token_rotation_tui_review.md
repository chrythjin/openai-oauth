# 자동 토큰 로테이션 TUI — 설계 검토 및 리스크 평가

**작성일:** 2026-05-25  
**상태:** 검토 전용 (구현 미착수)  
**관련 작업:** A 에러 표출 구현 완료 후 B 후속 검토

---

## 1. 배경

현재 `usage_limit_reached` 에러는 A 작업으로 클라이언트에 즉시 표출되도록 수정됐다.  
B는 그 에러를 감지해 **자동으로 다른 토큰 슬롯으로 전환**하는 워치독/TUI를 추가하는 아이디어다.

---

## 2. 핵심 제약 (변경 불가)

| 제약 | 근거 |
|---|---|
| 토큰 핫스왑 불가 | `POST /api/tokens/switch` → `restart_required: true`. auth 캐시가 프로세스 수명 동안 고정됨 |
| 자동 로테이션 = 자동 재시작 | 슬롯 전환은 반드시 서비스 stop → start 포함 |
| 서비스 컨트롤은 `.codex/scripts/` 소유 | 아키텍처 결정: 프록시 코드가 자기 자신을 재시작하지 않음 |
| 단일 프록시 원칙 | 같은 `CODEX_HOME`/`usage.sqlite`를 여러 프로세스가 공유하면 SQLite 잠금 충돌 |

---

## 3. 권장 구현 형태: B1 외부 워치독

### 3.1 동작 흐름

```
[stderr.log tail] → usage_limit_reached 감지
    → 쿨다운 체크 (같은 슬롯 연속 재진입 방지)
    → 다음 슬롯 선택 (rotate 또는 지정 슬롯)
    → sc stop OpenAIOAuthProxy
    → 포트 10531 해제 대기 (최대 10초)
    → 슬롯 전환 (manage-tokens.bat switch N)
    → sc start OpenAIOAuthProxy
    → /health 확인 (최대 15초)
    → 성공/실패 로그
```

### 3.2 진입점

```powershell
# 비대화형
.codex\launchers\manage-tokens.bat auto-rotate start
.codex\launchers\manage-tokens.bat auto-rotate stop
.codex\launchers\manage-tokens.bat auto-rotate status

# 대화형 메뉴 (manage-tokens.bat 옵션 추가)
[A] Auto-rotate on quota: ON / OFF
```

### 3.3 상태 파일

```json
// ~/.codex/auto-rotate.json
{
  "enabled": true,
  "lastRotatedAt": "2026-05-25T09:00:00Z",
  "lastRotatedFromSlot": 1,
  "cooldownMinutes": 5,
  "consecutiveFailures": 0
}
```

---

## 4. 리스크 평가

### 4.1 높음

| 리스크 | 설명 | 완화 방법 |
|---|---|---|
| **모든 슬롯 소진 무한 루프** | 슬롯 3개 모두 한도 차면 계속 재시작 반복 | 모든 슬롯 시도 후 실패 시 워치독 자동 중단 + 알림 |
| **재시작 중 인플라이트 요청 강제 종료** | `sc stop`은 진행 중인 스트리밍 요청을 끊음 | 재시작 전 짧은 drain 대기(5초) 추가 가능하나 완전 보장 불가 |
| **stderr.log 파싱 취약성** | 로그 포맷 변경 시 감지 실패 | A 작업으로 에러가 클라이언트에도 가므로, 대안으로 `/health` 엔드포인트에 quota 상태 노출 고려 |

### 4.2 중간

| 리스크 | 설명 | 완화 방법 |
|---|---|---|
| **쿨다운 없는 연속 재시작** | 슬롯 전환 후 새 슬롯도 즉시 한도 차면 재시작 폭풍 | 슬롯당 최소 5분 쿨다운 |
| **관리자 권한 필요** | `sc stop/start`는 UAC 필요 | 워치독 자체를 관리자 권한으로 실행하거나, NSSM 설정으로 일반 사용자 서비스 컨트롤 허용 |
| **상태 파일 동시 쓰기** | 워치독 여러 인스턴스 실행 시 충돌 | PID 잠금 파일로 단일 인스턴스 보장 |

### 4.3 낮음

| 리스크 | 설명 |
|---|---|
| **재시작 중 OpenCode 세션 끊김** | OpenCode가 재연결 시도하므로 일시적 |
| **로그 파일 회전 시 tail 끊김** | 워치독이 파일 재오픈 로직 필요 |

---

## 5. 대안: 프록시 내부 quota 상태 노출

워치독 대신 프록시가 `/health` 또는 `/api/dashboard/quota` 엔드포인트에 quota 상태를 노출하면:

```json
// GET /health (확장)
{
  "ok": true,
  "replay_state": "stateless",
  "quota": {
    "primary_used_percent": 100,
    "primary_resets_in_seconds": 8935,
    "limit_reached": true
  }
}
```

이 방식의 장점:
- 워치독이 stderr 파싱 대신 `/health` 폴링으로 안정적 감지
- 대시보드 UI에서도 quota 상태 표시 가능
- 프록시 코드 변경은 최소 (응답 헤더 `x-codex-*` 값을 캐시해 노출)

단점:
- 업스트림 응답 헤더를 프록시가 파싱/저장해야 함 (현재 미구현)
- 정기 폴링이 API 쿼터를 소비할 수 있음 (단, `/health`는 업스트림 호출 없음)

---

## 6. 구현 우선순위 권고

1. **지금 당장 필요 없음** — A 작업으로 에러가 즉시 표출되므로 사용자가 수동으로 `manage-tokens.bat rotate`를 실행하면 됨
2. **quota 헤더 캐시 + `/health` 노출** — 워치독보다 안전하고 대시보드 연동도 가능. 중기 개선으로 적합
3. **B1 외부 워치독** — 완전 자동화가 필요할 때. 위 리스크 완화 조치 모두 구현 후 진행

---

## 7. 결론

B1 워치독은 기술적으로 실현 가능하고 `.codex/scripts/` 레이어에 깔끔하게 맞는다.  
그러나 **모든 슬롯 소진 루프**, **인플라이트 요청 강제 종료**, **관리자 권한** 세 가지 리스크를 완화하는 코드가 없으면 안정성 원칙에 위배된다.  
A 작업 완료 후 현재 상태에서는 수동 로테이션으로 충분하며, 자동화는 quota 헤더 캐시 구현 이후 단계로 미루는 것을 권장한다.
