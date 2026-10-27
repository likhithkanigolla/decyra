-- Update assign_adr_number to respect explicit adr_number and full_id during ADR import/migration
CREATE OR REPLACE FUNCTION public.assign_adr_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code TEXT;
  _next INT;
BEGIN
  SELECT code INTO _code FROM public.projects WHERE id = NEW.project_id;
  
  -- If full_id and adr_number are already supplied with valid values (e.g., from migration or import),
  -- respect them and advance the project's sequence if needed.
  IF NEW.adr_number IS NOT NULL AND NEW.adr_number > 0 AND NEW.full_id IS NOT NULL AND NEW.full_id <> 'PENDING' AND NEW.full_id <> '' THEN
    UPDATE public.projects SET adr_sequence = GREATEST(adr_sequence, NEW.adr_number) WHERE id = NEW.project_id;
    RETURN NEW;
  END IF;

  UPDATE public.projects SET adr_sequence = adr_sequence + 1 WHERE id = NEW.project_id RETURNING code, adr_sequence INTO _code, _next;
  NEW.adr_number := _next;
  NEW.full_id := _code || '-ADR-' || LPAD(_next::TEXT, 3, '0');
  RETURN NEW;
END; $$;
