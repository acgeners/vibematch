export const TAG_GROUP_IDS = {
  "activities": "9b18e0be-5f31-499d-8cd7-f0ca12fe61cb",
  "cast": "af1a8bbc-48de-4ea3-bbb2-93f65f204814",
  "characters": "1a95e7da-d669-4ebd-8bb6-54d52cdcc90a",
  "conflict": "b1940a99-7aaf-427b-82fa-4c2b27632ae7",
  "﻿content_indicator": "90edf1bb-a80e-459e-b421-ebca4e493128",
  "elements": "9f18fecc-5a0a-46ab-93b0-eb9c1c8f804f",
  "fantasy": "d86c1b07-5f44-4526-9416-70ddc80c6927",
  "format": "575383cc-8464-40e0-91dd-b0689903fb66",
  "genre": "04eadb9a-5cc8-42ec-bbb3-1408fd7a1b7e",
  "other": "606e6239-515b-46c5-b985-9f41f948cdc9",
  "relationship_dynamics": "b66edefb-67f3-4c8d-8c16-b6f00ab07ddf",
  "romance": "1dd17228-8315-41e1-9ab9-9eaa3b4a3f4f",
  "school_youth": "56378f06-46e4-4d6d-a9f5-1abee5ae1c68",
  "scifi": "cccba365-27b6-4a3c-993f-e23c65cbed57",
  "setting": "8414f758-0cdb-482c-b601-8bb46735c9bb",
  "social_political": "54a24215-73dc-4272-8d87-f6a4d195d137",
  "superpowers": "7f087175-85e0-4a2e-84f7-0a6596e00712",
  "themes": "ff056916-7057-4d7e-9dab-b1cfdda5150a",
  "tone_mood": "5aef36df-a419-43de-b2c1-c067dd8e90f4",
} as const

export type TagGroupSlug = keyof typeof TAG_GROUP_IDS

export const TAG_GROUP_LABELS: Record<TagGroupSlug, string> = {
  "activities": "Activities",
  "cast": "Cast",
  "characters": "Characters",
  "conflict": "Conflict",
  "﻿content_indicator": "﻿Content Indicator",
  "elements": "Elements",
  "fantasy": "Fantasy",
  "format": "Format",
  "genre": "Genre",
  "other": "Other",
  "relationship_dynamics": "Relationship Dynamics",
  "romance": "Romance",
  "school_youth": "School / Youth",
  "scifi": "Sci-Fi",
  "setting": "Setting",
  "social_political": "Social / Political",
  "superpowers": "Superpowers",
  "themes": "Themes",
  "tone_mood": "Tone & Mood",
}

export const ACTIVITIES_TAG_GROUP_ID = TAG_GROUP_IDS["activities"]
export const CAST_TAG_GROUP_ID = TAG_GROUP_IDS["cast"]
export const CHARACTERS_TAG_GROUP_ID = TAG_GROUP_IDS["characters"]
export const CONFLICT_TAG_GROUP_ID = TAG_GROUP_IDS["conflict"]
export const CONTENT_INDICATOR_TAG_GROUP_ID = TAG_GROUP_IDS["﻿content_indicator"]
export const ELEMENTS_TAG_GROUP_ID = TAG_GROUP_IDS["elements"]
export const FANTASY_TAG_GROUP_ID = TAG_GROUP_IDS["fantasy"]
export const FORMAT_TAG_GROUP_ID = TAG_GROUP_IDS["format"]
export const GENRE_TAG_GROUP_ID = TAG_GROUP_IDS["genre"]
export const OTHER_TAG_GROUP_ID = TAG_GROUP_IDS["other"]
export const RELATIONSHIP_DYNAMICS_TAG_GROUP_ID = TAG_GROUP_IDS["relationship_dynamics"]
export const ROMANCE_TAG_GROUP_ID = TAG_GROUP_IDS["romance"]
export const SCHOOL_YOUTH_TAG_GROUP_ID = TAG_GROUP_IDS["school_youth"]
export const SCIFI_TAG_GROUP_ID = TAG_GROUP_IDS["scifi"]
export const SETTING_TAG_GROUP_ID = TAG_GROUP_IDS["setting"]
export const SOCIAL_POLITICAL_TAG_GROUP_ID = TAG_GROUP_IDS["social_political"]
export const SUPERPOWERS_TAG_GROUP_ID = TAG_GROUP_IDS["superpowers"]
export const THEMES_TAG_GROUP_ID = TAG_GROUP_IDS["themes"]
export const TONE_MOOD_TAG_GROUP_ID = TAG_GROUP_IDS["tone_mood"]
