export const HOMEPAGE_FEATURED_LIMIT = 6;

export interface FeaturedDreamRecord {
  id: string;
  dream_text: string;
  answer_text: string | null;
  created_at: string;
  answered_at: string | null;
  updated_at: string;
  status: string;
  featured_home: number;
}

export interface FeaturedDreamCard {
  title: string;
  excerpt: string;
  url: string;
}

const decodeEntities = (value: string): string => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

export const featuredDreamPlainText = (value: string): string => decodeEntities(value)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/!\[([^\]\n]*)\]\([^\n)]*\)/g, '$1')
  .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, '$1')
  .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const excerpt = (value: string, maximumLength: number): string => {
  const text = featuredDreamPlainText(value);
  const characters = Array.from(text);
  if (characters.length <= maximumLength) return text;

  const candidate = characters.slice(0, maximumLength + 1).join('');
  const boundary = candidate.lastIndexOf(' ');
  const shortened = boundary > 0 ? candidate.slice(0, boundary) : characters.slice(0, maximumLength).join('');
  return `${shortened.trimEnd()}…`;
};

const publicDate = (dream: FeaturedDreamRecord): number => {
  const date = Date.parse(dream.answered_at || dream.updated_at || dream.created_at);
  return Number.isNaN(date) ? 0 : date;
};

export const selectHomepageFeaturedDreams = (
  records: FeaturedDreamRecord[],
): FeaturedDreamCard[] => records
  .filter((dream) => (
    dream.featured_home === 1
    && dream.status === 'answered'
    && typeof dream.answer_text === 'string'
    && dream.answer_text.trim() !== ''
  ))
  .sort((a, b) => publicDate(b) - publicDate(a) || b.id.localeCompare(a.id))
  .slice(0, HOMEPAGE_FEATURED_LIMIT)
  .map((dream) => ({
    title: excerpt(dream.dream_text, 70) || 'Երազի մեկնաբանություն',
    excerpt: excerpt(dream.answer_text || '', 180),
    url: `/chgtnvac-erazner/${encodeURIComponent(dream.id)}/`,
  }));
