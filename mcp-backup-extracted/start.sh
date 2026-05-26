#!/bin/bash
#==========================================
# openai-oauth MCP 서버 시작
#
# MCP 서버模式的: OpenCode의 skill_mcp로 호출
# 사용 도구: start_proxy, stop_proxy, proxy_status, chatgpt_complete
#==========================================

set -e

cd "C:/NEW PRG/openai-oauth/packages/openai-oauth-mcp"

echo "=========================================="
echo "  openai-oauth MCP Server"
echo "=========================================="
echo ""
echo "Workdir: C:/NEW PRG/openai-oauth/packages/openai-oauth-mcp"
echo "Command: node dist/index.js"
echo ""
echo "Press Ctrl+C to stop"
echo "=========================================="
echo ""

bun run build
node dist/index.js