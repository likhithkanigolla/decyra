# Architecture Hub (Decyra)

Architecture Hub (internally referred to as Decyra) is a modern, collaborative platform for creating, tracking, and managing **Architecture Decision Records (ADRs)** across multiple projects. Built on top of a cutting-edge React tech stack, it provides organizations with the ability to codify their architectural decisions, visualize relationships between them, and ensure decisions are properly reviewed and approved.

## 🚀 Features

- **ADR Management**: Create rich Architecture Decision Records with Markdown support. Document Context, Decisions, Consequences, Alternatives, Design Changes, and Major Impacts.
- **Project Workspaces**: Group ADRs by project. Restrict visibility and editing rights to assigned project members.
- **Workflow & Approvals**: Transition ADRs through robust states (`Draft` -> `Under Review` -> `Approved` -> `Published`). Request mandatory reviews and track who approved or requested changes.
- **Versioning**: Edit published ADRs automatically bumps them back into a draft state, while safely archiving the previously published Markdown in the version history.
- **Relationship Graph**: Visually track dependencies across ADRs (e.g. `depends_on`, `supersedes`, `conflicts_with`) using an interactive, auto-layout React Flow graph. Supports cross-project dependencies.
- **Duplicate Detection**: Smart, NLP-style keyword extraction actively warns you if a similar ADR already exists across your organization while you are typing, preventing duplicated engineering efforts.
- **Dual Database Modes**: Run the application completely locally via PostgreSQL/Docker (`isDatabaseLocal = true`) or connect it to a managed Supabase backend.
- **Git Integration (Upcoming)**: Sync published ADRs directly to your Git repositories as a single source of truth.

## 🛠 Tech Stack

- **Frontend Framework**: [TanStack Start](https://tanstack.com/start) (React + SSR)
- **Routing**: [TanStack Router](https://tanstack.com/router/latest)
- **State Management**: [TanStack Query](https://tanstack.com/query/latest)
- **Styling**: Tailwind CSS + Radix UI Primitives
- **Graph Visualization**: [React Flow](https://reactflow.dev/)
- **Database**: PostgreSQL (via local `pg` client or Supabase)
- **Icons**: Lucide React

## 📦 Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- Docker (for local PostgreSQL database)

### Installation

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file in the root directory.
   ```env
   DATABASE_TYPE=postgres
   VITE_DATABASE_TYPE=postgres
   LOCAL_DEV_MODE=true
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architecture_hub
   ```

3. **Database Setup:**
   Run the setup script which will spin up a local PostgreSQL container and run the migrations:
   ```bash
   npm run db:setup
   ```
   
   To tear down the database:
   ```bash
   npm run db:stop
   ```

4. **Seed the Database (Optional):**
   ```bash
   npm run seed
   ```

### Running the Application

To start the local development server:
```bash
npm run dev:local
```

This will run the application in `LOCAL_DEV_MODE` ensuring it talks to your local PostgreSQL instance rather than requiring Supabase credentials.

## 🗄 Project Structure

- `/src/components/decyra`: Reusable UI components specifically designed for the ADR experience (Forms, Status Badges, etc).
- `/src/lib/api`: TanStack server functions (`decyra.functions.ts`) handling all database interactions securely on the backend.
- `/src/routes`: TanStack file-based routing tree managing all pages and layouts.
- `/supabase/migrations`: SQL migration scripts containing the database schema, RLS policies, and triggers.

## 🔒 Security & Access Control

Access control is strictly enforced on both the backend SQL queries and the UI layer. 
- **Platform Admins**: Have global access to view, assign, and manage all projects and ADRs.
- **Project Members**: Can only view and edit ADRs for projects they have been explicitly assigned to.
