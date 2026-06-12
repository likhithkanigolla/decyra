
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'member');
CREATE TYPE public.project_role AS ENUM ('project_admin', 'engineer', 'intern');
CREATE TYPE public.adr_status AS ENUM ('draft', 'under_review', 'approved', 'published', 'superseded');
CREATE TYPE public.relationship_type AS ENUM ('depends_on', 'related_to', 'supersedes', 'superseded_by', 'conflicts_with', 'affects');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============ USER_ROLES (platform) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read user_roles" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ PROJECTS ============
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  repo_url TEXT,
  branch TEXT DEFAULT 'main',
  adr_path TEXT DEFAULT 'docs/adr',
  adr_sequence INT NOT NULL DEFAULT 0,
  required_approvals INT NOT NULL DEFAULT 3,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ============ PROJECT_MEMBERS ============
CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.project_role NOT NULL DEFAULT 'engineer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id)
$$;

CREATE OR REPLACE FUNCTION public.has_project_role(_user_id UUID, _project_id UUID, _role public.project_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id AND role = _role)
$$;

-- Projects policies
CREATE POLICY "Members or admins view projects" ON public.projects FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), id));
CREATE POLICY "Admins create projects" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins or project_admins update" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), id, 'project_admin'));
CREATE POLICY "Admins delete projects" ON public.projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Project members policies
CREATE POLICY "View memberships of own projects" ON public.project_members FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins/project_admins add members" ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), project_id, 'project_admin'));
CREATE POLICY "Admins/project_admins update members" ON public.project_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), project_id, 'project_admin'));
CREATE POLICY "Admins/project_admins remove members" ON public.project_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), project_id, 'project_admin'));

-- ============ ADRs ============
CREATE TABLE public.adrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  adr_number INT NOT NULL,
  full_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status public.adr_status NOT NULL DEFAULT 'draft',
  tags TEXT[] NOT NULL DEFAULT '{}',
  context TEXT DEFAULT '',
  decision TEXT DEFAULT '',
  consequences TEXT DEFAULT '',
  alternatives TEXT DEFAULT '',
  design_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  major_impacts JSONB NOT NULL DEFAULT '{}'::jsonb,
  references_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  author_id UUID NOT NULL REFERENCES auth.users(id),
  current_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, adr_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.adrs TO authenticated;
GRANT ALL ON public.adrs TO service_role;
ALTER TABLE public.adrs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view adrs" ON public.adrs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Members create adrs" ON public.adrs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Members update adrs" ON public.adrs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins/project_admins delete adrs" ON public.adrs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), project_id, 'project_admin'));

-- ============ PUBLISHED_VERSIONS ============
CREATE TABLE public.published_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  markdown TEXT NOT NULL,
  git_commit_hash TEXT,
  published_by UUID NOT NULL REFERENCES auth.users(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(adr_id, version_number)
);
GRANT SELECT, INSERT ON public.published_versions TO authenticated;
GRANT ALL ON public.published_versions TO service_role;
ALTER TABLE public.published_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view published versions" ON public.published_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), a.project_id))));
CREATE POLICY "Project_admins or admins publish" ON public.published_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND (public.has_role(auth.uid(), 'admin') OR public.has_project_role(auth.uid(), a.project_id, 'project_admin'))));

-- ============ APPROVALS ============
CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(adr_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view approvals" ON public.approvals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), a.project_id))));
CREATE POLICY "Members create approvals" ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND public.is_project_member(auth.uid(), a.project_id)) AND NOT public.has_project_role(auth.uid(), (SELECT project_id FROM public.adrs WHERE id = adr_id), 'intern'));
CREATE POLICY "Users update own approvals" ON public.approvals FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own approvals" ON public.approvals FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============ COMMENTS ============
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view comments" ON public.comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), a.project_id))));
CREATE POLICY "Members create comments" ON public.comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = adr_id AND public.is_project_member(auth.uid(), a.project_id)));
CREATE POLICY "Users update own comments" ON public.comments FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own comments" ON public.comments FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============ RELATIONSHIPS ============
CREATE TABLE public.adr_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  target_adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  rel_type public.relationship_type NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_adr_id, target_adr_id, rel_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.adr_relationships TO authenticated;
GRANT ALL ON public.adr_relationships TO service_role;
ALTER TABLE public.adr_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view relationships" ON public.adr_relationships FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = source_adr_id AND (public.has_role(auth.uid(), 'admin') OR public.is_project_member(auth.uid(), a.project_id))));
CREATE POLICY "Members create relationships" ON public.adr_relationships FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = source_adr_id AND public.is_project_member(auth.uid(), a.project_id)));
CREATE POLICY "Members delete relationships" ON public.adr_relationships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.adrs a WHERE a.id = source_adr_id AND public.is_project_member(auth.uid(), a.project_id)));

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER projects_touch BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER adrs_touch BEFORE UPDATE ON public.adrs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-number ADRs and set full_id
CREATE OR REPLACE FUNCTION public.assign_adr_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code TEXT;
  _next INT;
BEGIN
  UPDATE public.projects SET adr_sequence = adr_sequence + 1 WHERE id = NEW.project_id RETURNING code, adr_sequence INTO _code, _next;
  NEW.adr_number := _next;
  NEW.full_id := _code || '-ADR-' || LPAD(_next::TEXT, 3, '0');
  RETURN NEW;
END; $$;

CREATE TRIGGER adrs_assign_number BEFORE INSERT ON public.adrs FOR EACH ROW EXECUTE FUNCTION public.assign_adr_number();

-- Profile auto-create on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email));
  -- First user becomes admin
  IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
