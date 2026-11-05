-- Run as a reviewed database migration on the self-hosted Caçadores database.
-- Never expose the experiment ledger to anonymous or general authenticated clients.
BEGIN;
CREATE TABLE IF NOT EXISTS public.radar_packaging_experiments (
 id uuid PRIMARY KEY,
 channel_id text NOT NULL REFERENCES public.radar_managed_channels(id) ON DELETE RESTRICT,
 youtube_channel_id text NOT NULL CHECK (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 phase text NOT NULL DEFAULT 'draft'
    CHECK (phase IN ('draft','ready-for-approval','running','evaluated','learned','inconclusive')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS radar_packaging_experiments_by_channel
 ON public.radar_packaging_experiments(channel_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS radar_packaging_experiments_by_video
 ON public.radar_packaging_experiments(youtube_channel_id,video_id);
ALTER TABLE public.radar_packaging_experiments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.radar_packaging_experiments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.radar_packaging_experiments TO service_role;
COMMIT;
