# Dashboard Analysis Scratchpad

## Checklist
- [x] Navigate to https://github.com/Soju06/codex-lb
- [x] Identify tech stack (package.json)
- [x] Find dashboard source files
- [x] Analyze backend interaction (API endpoints)
- [x] Identify key dashboard features
- [x] Create Review Report (검토서)
- [x] Create Implementation Plan (변경 계획서)

## Findings
- **Tech Stack**: React 19, Vite, Tailwind CSS 4, TanStack Query, Zustand, Recharts, Radix UI (Frontend) / FastAPI, SQLAlchemy (Backend)
- **Structure**: Modular feature-based structure (`src/features/dashboard` for frontend, `app/modules/dashboard` for backend).
- **Backend Interaction**: REST API endpoints (`/api/dashboard`, `/api/request-logs`) called via `api-client` and TanStack Query hooks.
- **Key Features**: 
    - Real-time usage charts (requests, tokens, latency).
    - Detailed request logs with filtering.
    - Account and API key management UI.
    - Firewall/IP management.
    - Load balancer statistics.

## Summary of Architecture
The `codex-lb` project uses a modern React frontend with a Python (FastAPI) backend. The frontend is built with a focus on performance and developer experience using Vite and Bun. The UI is highly modular, using Radix UI for accessible components and Tailwind CSS 4 for styling. Charts are powered by Recharts, and data fetching is managed by TanStack Query, ensuring efficient state management and caching.

## Key Files (Target for Reference)
- `frontend/src/features/dashboard/components/`: UI components for charts and logs.
- `frontend/src/features/dashboard/api.ts`: API definitions for dashboard data.
- `frontend/src/features/dashboard/hooks/`: React Query hooks for seamless data integration.
- `app/modules/dashboard/`: Backend logic for aggregating usage statistics.
