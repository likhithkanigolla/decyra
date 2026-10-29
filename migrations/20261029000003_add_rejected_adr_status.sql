-- Add 'rejected' to public.adr_status enum so rejected ADRs can be formally represented and published
ALTER TYPE public.adr_status ADD VALUE IF NOT EXISTS 'rejected';
