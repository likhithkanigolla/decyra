# Architecture Hub (Decyra)

Architecture Hub (internally referred to as Decyra) is a modern, collaborative platform for creating, tracking, and managing **Architecture Decision Records (ADRs)** across multiple projects. Built on top of a cutting-edge React tech stack, it provides organizations with the ability to codify their architectural decisions, visualize relationships between them, and ensure decisions are properly reviewed and approved.

## 🚀 Features

- **Robust ADR Editor**: Create rich Architecture Decision Records with full Markdown support via a split-pane editor. Document Context, Decisions, Consequences, Alternatives, Design Changes, and Major Impacts.
- **Project Workspaces**: Group ADRs by project. Restrict visibility and editing rights to assigned project members.
- **Workflow & Approvals**: Transition ADRs through robust states (`Draft` -> `Under Review` -> `Approved` -> `Published`). Request mandatory reviews and track who approved or requested changes.
- **Versioning**: Editing published ADRs automatically bumps them back into a draft state, while safely archiving the previously published Markdown in the version history.
- **Relationship Graph**: Visually track dependencies across ADRs (e.g., `depends_on`, `supersedes`, `conflicts_with`) using an interactive, auto-layout React Flow graph. Supports cross-project dependencies.
- **Duplicate Detection**: Smart keyword extraction actively warns you if a similar ADR already exists across your organization while you are typing, preventing duplicated engineering efforts.
- **Dual Database Modes**: Run the application completely locally via PostgreSQL/Docker (`DATABASE_TYPE=postgres`) or connect it to a managed Supabase backend.
- **Onboarding Experience**: First-time setup creates the initial administrator, and empty projects allow you to instantly generate Demo ADRs to learn the system.

## 🛠 Tech Stack

- **Frontend Framework**: [TanStack Start](https://tanstack.com/start) (React + SSR)
- **Routing**: [TanStack Router](https://tanstack.com/router/latest)
- **State Management**: [TanStack Query](https://tanstack.com/query/latest)
- **Styling**: Tailwind CSS + Radix UI Primitives
- **Graph Visualization**: [React Flow](https://reactflow.dev/)
- **Database**: PostgreSQL (via local `pg` client or Supabase)
- **Icons**: Lucide React
- **Markdown Editor**: `@uiw/react-md-editor`

---

## 📦 Administrator Setup Guide

### Prerequisites
- Node.js (v20+ recommended)
- Docker & Docker Compose (for local PostgreSQL database)

### Installation

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repository-url>
   cd architecture-hub
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
   
   To tear down the database in the future:
   ```bash
   npm run db:stop
   ```

4. **Start the Development Server:**
   ```bash
   npm run dev:local
   ```
   The application will be available at `http://localhost:8080/decyra/`.

### Initial Platform Setup (First Run)

When you first launch the application, navigate to the Auth page. Since no admin exists yet, you will be prompted with the **Platform Setup** screen. 
1. Enter your Name, Email, Username, and Password to create the root **Administrator** account.
2. Once signed in, you can manage the entire workspace.

### Password Management (Local Mode)

If a user forgets their password in local development mode (where no email server is configured), administrators can reset passwords via the terminal:

```bash
npm run reset-password <email-or-username> <new-password>
```

*(Note: In Supabase mode, standard email password resets are supported via the UI).*

---

## 📖 User Manual

Welcome to Architecture Hub! This section explains how to use the platform on a daily basis.

### 1. Creating Projects
Projects are the top-level containers for your architectural decisions.
- Navigate to the **Projects** tab.
- Click **Create Project**. Provide a Name, a short Code (e.g., `CORE`), a Description, and the number of required approvals for ADRs in this project.
- Once created, you can invite other users to the project via the **Members** tab on the Project Details page.

### 2. Writing Architecture Decision Records (ADRs)
An ADR is a document that captures an important architectural decision made along with its context and consequences.
- Inside a Project, click **Create ADR**.
- Fill in the **Title** and **Tags**.
- Use the **Rich Markdown Editor** to draft your ADR. The editor features a live side-by-side preview.
- **Pro Tip**: Use the `Import from Markdown` button or upload a `.md` file to quickly parse an existing ADR into the platform.
- When finished drafting, click **Create Draft**.

*Don't want to start from scratch? Click **Generate Example ADR** on an empty project to see what a great ADR looks like!*

### 3. The Review Workflow
ADRs go through a strict state machine to ensure governance:
1. **Draft**: The ADR is being actively written. It can be freely edited.
2. **Under Review**: Once the draft is complete, click **Submit for review**. The ADR is locked, and project members must review it.
   - Reviewers can leave comments in the Discussion tab.
   - Reviewers must explicitly click **Approve** or **Reject (Request Changes)**.
3. **Approved**: Once the required number of approvals is met, the ADR can be marked as Approved.
4. **Published**: Project Administrators can click **Publish ADR**. This creates a permanent, read-only snapshot (`v1`) of the markdown.
   - If a Published ADR needs to be updated later, clicking Edit will bump it back to a **Draft** and increment the target version (e.g., to `v2`).

### 4. Linking ADRs & Graph View
Decisions rarely happen in a vacuum. You can link ADRs together to form a dependency graph.
- On any ADR page, look at the **Relationships** sidebar.
- Select a relationship type (e.g., `Depends on`, `Supersedes`).
- Search for another ADR and add the link.
- To see the big picture, go to the Project page and click **View Graph**. You'll see an interactive node graph of how all decisions connect.

### 5. Global Search
Looking for a specific decision across the entire organization?
- Use the global **Search ADRs** page (`/search`).
- Search by Title, Keyword, or Content.
- Use the filters to narrow down by Status (e.g., only show Published decisions) or Tags.

---

## 🔒 Security & Access Control

Access control is strictly enforced:
- **Platform Admins**: Have global access to view, assign, and manage all projects and ADRs across the organization.
- **Project Admins**: Can manage project settings, invite members, and publish ADRs within their assigned projects.
- **Engineers**: Can draft, comment on, and approve ADRs in their assigned projects.
- **Interns / Read-Only**: Can view ADRs in their projects and participate in discussions, but cannot approve decisions.

---

## 🗄 Project Structure (For Developers)

- `/src/components/decyra`: Reusable UI components specifically designed for the ADR experience (Markdown Editor, Forms, Status Badges).
- `/src/lib/api`: TanStack server functions (`decyra.functions.ts`) handling all database interactions securely on the backend.
- `/src/routes`: TanStack file-based routing tree managing all pages and layouts.
- `/supabase/migrations`: SQL migration scripts containing the database schema, user roles, and triggers.
- `/scripts`: Utility scripts for the local environment (e.g., `reset-password.ts`, `seed.ts`).
