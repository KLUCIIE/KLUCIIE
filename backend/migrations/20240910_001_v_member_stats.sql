CREATE OR REPLACE VIEW v_member_stats AS
SELECT
  p.id AS member_id,
  p.full_name,
  p.ciie_id,
  p.department,
  p.year_of_study,
  p.team,
  p.avatar_url,
  COALESCE(SUM(pt.points), 0)::int AS total_points,
  (SELECT COUNT(*)::int FROM attendance a WHERE a.member_id = p.id) AS events_attended,
  (SELECT COUNT(*)::int FROM event_team_members etm WHERE etm.member_id = p.id) AS events_worked,
  (SELECT COUNT(*)::int FROM duty_assignments da WHERE da.member_id = p.id) AS volunteer_activities,
  (SELECT COUNT(*)::int FROM member_achievements ma WHERE ma.member_id = p.id) AS achievements,
  (SELECT COUNT(*)::int FROM certificates c WHERE c.member_id = p.id) AS certificates
FROM profiles p
LEFT JOIN member_points_transactions pt ON pt.member_id = p.id
GROUP BY p.id, p.full_name, p.ciie_id, p.department, p.year_of_study, p.team, p.avatar_url;