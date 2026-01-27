-- Add broll_metadata field to assets table
-- Used to store B-roll source information (pexels, pixabay, kling)

ALTER TABLE assets ADD COLUMN IF NOT EXISTS broll_metadata JSONB;

-- Add index for faster queries on broll source
CREATE INDEX IF NOT EXISTS idx_assets_broll_source ON assets((broll_metadata->>'source'));

-- Add comment explaining the field
COMMENT ON COLUMN assets.broll_metadata IS 'B-roll metadata: {
  "source": "pexels|pixabay|kling",
  "external_id": "123456",
  "author": "Name",
  "author_url": "https://...",
  "original_url": "https://...",
  "license": "License info",
  "keywords": ["nature", "sunset"],
  "quality": "hd",
  "orientation": "landscape"
}';
