# Architecture Hub (Decyra)

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-TanStack_Start-blue.svg)]()
[![Database](https://img.shields.io/badge/database-PostgreSQL_18-336791.svg)]()

**Architecture Hub (Decyra)** is an open-source, collaborative engineering platform designed for creating, reviewing, visualizing, and governing **Architecture Decision Records (ADRs)** across multiple projects and repositories.

Built on TanStack Start (React SSR), PostgreSQL, and Git, Decyra empowers engineering organizations to codify architectural decisions, map dependencies, enforce strict approval workflows, and maintain synchronization with Git repositories.

> 📖 **Looking for the complete user guide?** Read the [Decyra Comprehensive User Manual](docs/USER_MANUAL.md).

---

## 🚀 Key Features

- **Split-Pane ADR Editor**: Rich Markdown editor with live preview, syntax highlighting, and standard ADR sections (Context, Decision, Consequences, Alternatives, Design Changes, Impacts, and References).
- **Flexible Authentication**: Sign in using **either your Email address or Username** + password.
- **Project Governance & Isolation**: Group architectural decisions by project domain. Control visibility and editing rights through role-based access control.
- **Strict Review State Machine**: Transition ADRs through formal stages:
  $$\text{Draft} \longrightarrow \text{Under Review} \longrightarrow \text{Approved} \longrightarrow \text{Published}$$
- **Multi-Approval Thresholds**: Configure the required number of approvals per project. Reviewers can formally **Approve** or **Request Changes**.
- **Project Deletion Protection (3 Approvals & Revocation)**: Prevents accidental or unauthorized project deletion by requiring **at least 3 separate approvals** from platform admins or project engineers, with full support for revoking approvals at any time.
- **Git Repository Integration**:
  - Automatically commits and pushes published ADRs to your Git branch.
  - Supports repository root (`/`) or custom subfolders (e.g. `docs/adr`).
  - **Mandatory Git Token validation** and **automated repository migration** when changing repository URLs, branches, or folders.
- **Repository ADR Import**: Import existing Markdown ADRs from any Git repository. Decyra validates and filters ADRs using the standard `[Project code-ADR-XXX]` format, automatically extracts clean titles, and preserves sequential numbering.
- **GitHub Two-Way Push Sync**: Configure push webhooks to automatically sync Markdown updates from GitHub directly into Decyra drafts.
- **Interactive Decision Graph**: Visual dependency mapping (`depends_on`, `supersedes`, `conflicts_with`, `related_to`) powered by React Flow with auto-layout and cross-project links.
- **Real-Time Collaborative Editing**: Real-time collaborative drafting with live collaborator presence powered by Yjs.
- **Duplicate Detection**: Real-time keyword analysis warns authors if a similar decision already exists across the organization, preventing redundant engineering efforts.
- **Data Archives**: Export and import self-contained JSON project archives for moving records between environments.

---

## 🛠 Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) (Full-stack React with SSR)
- **Routing**: [TanStack Router](https://tanstack.com/router)
- **Data Fetching**: [TanStack Query](https://tanstack.com/query)
- **Styling**: Tailwind CSS + Radix UI Primitives
- **Graph Visualization**: [React Flow](https://reactflow.dev/)
- **Database**: PostgreSQL 18 (via native `pg` connection pool)
- **Git Engine**: `simple-git`
- **Markdown & Editor**: `@uiw/react-md-editor`, `micromark`, `unified`
- **Testing**: Vitest

---

## 📦 Administrator Setup Guide

### Prerequisites
- **Node.js**: v20+ (v22+ recommended)
- **Docker & Docker Compose**: For the local PostgreSQL container
- **Git**: Installed and available in your environment path

### Quickstart Installation

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/likhithkanigolla/decyra.git
   cd decyra
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_TYPE=postgres
   VITE_DATABASE_TYPE=postgres
   LOCAL_DEV_MODE=true
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/decyra
   ```

3. **Start Database & Run Migrations:**
   Launch the local PostgreSQL container and automatically execute SQL schema migrations:
   ```bash
   npm run db:setup
   ```
   *(To stop the database container later: `npm run db:stop`)*

4. **Launch the Development Server:**
   ```bash
   npm run dev:local
   ```
   Open your browser to: **`http://localhost:8080/decyra/`**

### Initial Admin Setup (First Launch)
When opening Decyra for the first time:
1. Navigate to the sign-in screen.
2. Because no users exist yet, Decyra displays the **Platform Setup** wizard.
3. Enter your Name, Email, Username, and Password to create the root **Platform Administrator**.
4. Log in with either your **email** or **username**.

### User & Password Management
Administrators can reset user passwords directly via the terminal:
```bash
npm run reset-password <email-or-username> <new-password>
```

---

## 📖 Quick User Guide

> For detailed walkthroughs, consult the [Comprehensive User Manual](docs/USER_MANUAL.md).

### 1. Creating and Configuring a Project
- Navigate to **Projects** $\rightarrow$ **New Project**.
- Set **Name**, **Project Code** (e.g., `DEC` or `CORE`), **Description**, and **Required Approvals** (default: `3`).
- Enter your Git Repository URL, Branch, and ADR Path (`/` for repository root, or a directory like `docs/adr`).
- When editing an existing project, entering your **Git Token is mandatory**, and modifying repository details automatically migrates all existing ADRs to the new destination.

### 2. Project Deletion Safety (3 Approvals Required)
- Permanent project deletion requires **at least 3 separate approvals** from platform admins or project engineers.
- Team members can click **Approve Deletion** or **Revoke Approval**.
- Once 3 approvals are recorded, an authorized admin can execute permanent deletion.

### 3. Writing and Reviewing ADRs
- Click **New ADR** in your project workspace.
- Complete the required sections (**Context**, **Decision**, and **Consequences**).
- When ready for team feedback, click **Submit for Review**.
- Assigned project engineers review the proposal, discuss in the comment thread, and click **Approve** or **Request Changes**.

### 4. Publishing & Git Sync
- Once approvals reach the required threshold, a Project Admin clicks **Publish ADR**.
- Decyra compiles the ADR into a permanent Markdown snapshot (`v1`) and automatically commits it to your Git repository.
- If changes are needed in the future, clicking **Edit** on a published ADR increments the revision target to `v2` and initiates a new review cycle.

### 5. Importing Existing ADRs from Git
- Open your project and click **Import ADRs**.
- Point to your repository branch and directory (use `/` for repo root).
- Decyra verifies each file against the `[Project code-ADR-XXX]` format (e.g. `[DEC-ADR-001]`), preserves sequential IDs, cleans duplicate headings, and safely ignores non-ADR files like `README.md`.

### 6. Mapping Relationships & Exploring the Graph
- Link related decisions from the **Relationships** sidebar (`depends_on`, `supersedes`, `conflicts_with`).
- Click **Graph** in the project header to view an interactive auto-layout network of all architecture decisions.

---

## 🔒 Security & Access Control

Access permissions are enforced on both the client UI and server function endpoints:

| Role | Scope | Permissions |
| :--- | :--- | :--- |
| **Platform Admin** | Global | Full administrative access to all projects, user accounts, and system settings. Can delete projects once 3 approvals are met. |
| **Project Admin** | Project | Manages project configuration, invites members, publishes ADRs, and manages project deletion. |
| **Engineer** | Project | Can author ADR drafts, leave review comments, approve ADRs, and approve/revoke project deletion. |
| **Intern** | Project | Can view project ADRs and participate in discussion threads, but cannot approve decisions or project deletion. |

---

## 🧪 Verification & Testing

Decyra includes an automated test suite verifying database services, Git operations, security rules, and markdown parsers:

```bash
# Run all unit and integration tests
npm run test

# Run linter
npm run lint

# Build production bundle
npm run build
```

---

## 📁 Repository Structure

```
├── docs/                        # Detailed guides and User Manual
│   ├── USER_MANUAL.md           # Comprehensive platform user manual
│   ├── DATABASE_SETUP.md        # Database configuration details
│   └── SampleADR.md             # Standard ADR Markdown reference template
├── migrations/                  # SQL schema migrations
├── src/
│   ├── components/decyra/       # ADR editors, graph viewers, status badges
│   ├── integrations/database/   # PostgreSQL connection pool and auth middleware
│   ├── lib/api/                 # TanStack server functions and Git sync engines
│   └── routes/                  # TanStack Router file-based route hierarchy
├── tests/                       # Vitest automated test suites
└── scripts/                     # Administration utilities (password reset, setup)
```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
