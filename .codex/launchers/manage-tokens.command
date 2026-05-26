#!/bin/bash

# 현재 스크립트의 위치를 기준으로 프로젝트 루트 디렉토리로 이동합니다.
# (.codex/launchers/manage-tokens.command -> 프로젝트 루트)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/../../"

echo "=== OpenAI OAuth Token Manager (macOS) ==="

# bun이 설치되어 있는지 확인합니다.
if ! command -v bun &> /dev/null
then
    echo "오류: 'bun'을 찾을 수 없습니다."
    echo "먼저 아래 명령어를 터미널에 실행하여 bun을 설치해 주세요:"
    echo "curl -fsSL https://bun.sh/install | bash"
    echo ""
    echo "엔터를 누르면 종료됩니다..."
    read
    exit 1
fi

# 토큰 관리 도구 실행
bun run token
