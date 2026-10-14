ALTER TABLE review_schedule ADD COLUMN goal_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX review_due_goal ON review_schedule(project_id,goal_version,status,due_date);
