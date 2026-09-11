-- Allow multiple interview opinions per applicant: one row per (application, kind, evaluator).
ALTER TABLE recruit_evaluations DROP CONSTRAINT IF EXISTS recruit_evaluations_app_kind_unique;
ALTER TABLE recruit_evaluations ADD CONSTRAINT recruit_evaluations_app_kind_evaluator_unique UNIQUE (application_id, kind, evaluator_id);