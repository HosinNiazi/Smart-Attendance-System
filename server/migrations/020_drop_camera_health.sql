-- Camera-health telemetry was removed from the product: it reported a
-- browser-scoped camera id as if it were a classroom device, so the dashboard
-- overpromised and could mislead administrators. Face events remain the
-- audit trail for recognition decisions.
DROP TABLE IF EXISTS camera_health_samples;
