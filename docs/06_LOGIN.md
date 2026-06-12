# IMS — Login Guide

**Application URL:** https://ims.urbanwerkzsg.com

Sign-in uses a **username** (not an email address) and a password.

## How to sign in

1. Open **https://ims.urbanwerkzsg.com** in your browser (Chrome, Edge, Safari, or Firefox).
2. Enter your **username** and **password**.
3. Click **Sign in**. You land on the Dashboard for your active project.
4. If you belong to more than one project, switch projects with the
   **Project selector** at the top-left — your permissions adapt to your role
   on each project.
5. To sign out, click **Sign out** at the top-right.

## Accounts

| Username | Password | Role | What you can do |
|---|---|---|---|
| `admin` | `admin123` | Organization admin | Everything: users, sites, projects, custom fields, currencies & FX |
| `manager` | `manager123` | Manager (Maintenance-CNW) | Approve/record write-offs, reverse transactions, archive items, manage custom fields & suppliers, run reports |
| `tech` | `tech123` | Technician (Maintenance-CNW) | Record stock movements (issue / receive / transfer / adjust), create & edit items, look up parts |
| `audit` | `audit123` | Viewer / Auditor (Maintenance-CNW) | Read-only: browse inventory, transaction history, and reports; export data |

> ⚠️ **These are the initial passwords — change them immediately**
> (sign in as `admin` → Admin → Users → select user → set new password).
> The admin can also create personal accounts for each team member
> (username + password; email is optional) and deactivate unused ones.

## Sessions

- Your session stays signed in for up to **7 days**; it refreshes automatically
  while you use the app.
- After signing out (or after 7 days idle) you'll need to sign in again.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Invalid username or password" | Check spelling and Caps Lock — passwords are case-sensitive. Ask an admin to reset your password. |
| "You are not a member of this project" | An admin must add you to the project (Admin → Sites & Projects → Project members). |
| Page won't load | Check your internet connection, then hard-refresh (Ctrl/Cmd-Shift-R). If it persists, contact the administrator. |
| Account deactivated | Only an organization admin can re-activate an account. |
