CREATE UNIQUE INDEX "appointments_active_slot_unique" ON "appointments" ("clinic_id", "starts_at") WHERE status IN ('pending','confirmed');
