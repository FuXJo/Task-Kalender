import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  "https://nsjybamzaavgyrowkjbq.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zanliYW16YWF2Z3lyb3dramJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNzg3NzMsImV4cCI6MjA4NTk1NDc3M30.snPdt9bvF2a0w-SB2OYBXu7wTm0OETH9R8vtAQAQn_Q"
)