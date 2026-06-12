-- Add git_pat column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_pat text;
