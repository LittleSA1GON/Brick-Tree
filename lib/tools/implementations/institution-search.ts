import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

type CatalogEntry = RawSearchResult & {
  keywords: string[];
  schoolFriendly?: boolean;
  advancedFriendly?: boolean;
};

const CATALOG: CatalogEntry[] = [
  {
    title: "Algebra 1",
    url: "https://www.khanacademy.org/math/algebra",
    source: "Khan Academy",
    snippet: "Free guided algebra lessons, worked examples, and practice designed for school-level learners.",
    type: "course",
    keywords: ["algebra", "equation", "polynomial", "linear", "function"],
    schoolFriendly: true,
  },
  {
    title: "Geometry",
    url: "https://www.khanacademy.org/math/geometry",
    source: "Khan Academy",
    snippet: "School-level geometry lessons and practice from Khan Academy.",
    type: "course",
    keywords: ["geometry", "triangle", "circle", "angle", "proof"],
    schoolFriendly: true,
  },
  {
    title: "Statistics and probability",
    url: "https://www.khanacademy.org/math/statistics-probability",
    source: "Khan Academy",
    snippet: "Introductory statistics and probability with practice and examples.",
    type: "course",
    keywords: ["statistics", "probability", "distribution", "mean", "variance"],
    schoolFriendly: true,
  },
  {
    title: "Calculus 1",
    url: "https://www.khanacademy.org/math/calculus-1",
    source: "Khan Academy",
    snippet: "Approachable lessons on limits, derivatives, integrals, and introductory calculus.",
    type: "course",
    keywords: ["calculus", "derivative", "integral", "limit", "chain rule"],
    schoolFriendly: true,
  },
  {
    title: "Algebra and Trigonometry",
    url: "https://openstax.org/details/books/algebra-and-trigonometry",
    source: "OpenStax",
    snippet: "Peer-reviewed open textbook from OpenStax for algebra and trigonometry.",
    type: "reference",
    keywords: ["algebra", "trigonometry", "function", "equation", "precalculus"],
    schoolFriendly: true,
  },
  {
    title: "College Physics 2e",
    url: "https://openstax.org/details/books/college-physics-2e",
    source: "OpenStax",
    snippet: "Peer-reviewed open physics textbook suitable for introductory study.",
    type: "reference",
    keywords: ["physics", "mechanics", "energy", "force", "electricity", "motion"],
    schoolFriendly: true,
  },
  {
    title: "Biology 2e",
    url: "https://openstax.org/details/books/biology-2e",
    source: "OpenStax",
    snippet: "Peer-reviewed open biology textbook from OpenStax.",
    type: "reference",
    keywords: ["biology", "cell", "genetics", "evolution", "ecology"],
    schoolFriendly: true,
  },
  {
    title: "Chemistry 2e",
    url: "https://openstax.org/details/books/chemistry-2e",
    source: "OpenStax",
    snippet: "Peer-reviewed open chemistry textbook from OpenStax.",
    type: "reference",
    keywords: ["chemistry", "atom", "molecule", "reaction", "stoichiometry"],
    schoolFriendly: true,
  },
  {
    title: "Introduction to Computer Science and Programming in Python",
    url: "https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/",
    source: "MIT OpenCourseWare",
    snippet: "MIT introductory programming course using Python.",
    type: "course",
    keywords: ["python", "programming", "computer science", "algorithm", "coding"],
    advancedFriendly: true,
  },
  {
    title: "CS50x: Introduction to Computer Science",
    url: "https://cs50.harvard.edu/x/",
    source: "Harvard CS50",
    snippet: "Harvard's introductory computer science course with lectures, notes, and problem sets.",
    type: "course",
    keywords: ["computer science", "programming", "algorithm", "software", "coding"],
    schoolFriendly: true,
    advancedFriendly: true,
  },
  {
    title: "Python Tutorial",
    url: "https://docs.python.org/3/tutorial/",
    source: "Python Documentation",
    snippet: "Official Python language tutorial and reference material.",
    type: "documentation",
    keywords: ["python", "programming", "function", "class", "module"],
    advancedFriendly: true,
  },
  {
    title: "MDN Learn Web Development",
    url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    source: "MDN Web Docs",
    snippet: "Structured web-development learning material maintained by MDN.",
    type: "documentation",
    keywords: ["javascript", "html", "css", "web", "frontend", "react"],
    schoolFriendly: true,
    advancedFriendly: true,
  },
  {
    title: "Machine Learning Crash Course",
    url: "https://developers.google.com/machine-learning/crash-course",
    source: "Google for Developers",
    snippet: "Google's practical machine-learning course covering core concepts and model development.",
    type: "course",
    keywords: ["machine learning", "regression", "classification", "neural network", "model"],
    advancedFriendly: true,
  },
  {
    title: "CS229: Machine Learning",
    url: "https://cs229.stanford.edu/",
    source: "Stanford University",
    snippet: "Stanford's machine-learning course materials for learners ready for mathematical treatment.",
    type: "course",
    keywords: ["machine learning", "supervised", "unsupervised", "regression", "classification", "optimization"],
    advancedFriendly: true,
  },
  {
    title: "Single Variable Calculus",
    url: "https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/",
    source: "MIT OpenCourseWare",
    snippet: "MIT calculus course with lectures, notes, examples, and problem sets.",
    type: "course",
    keywords: ["calculus", "derivative", "integral", "limit", "series"],
    advancedFriendly: true,
  },
];

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+.#\- ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function scoreEntry(entry: CatalogEntry, query: string): number {
  const normalized = query.toLowerCase();
  const queryTokens = new Set(tokens(query));
  let score = 0;

  for (const keyword of entry.keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (normalized.includes(normalizedKeyword)) score += normalizedKeyword.includes(" ") ? 8 : 5;
    for (const token of tokens(normalizedKeyword)) if (queryTokens.has(token)) score += 2;
  }

  const schoolAudience = /(elementary|middle-school|middle school|high-school|high school|novice|beginner)/.test(normalized);
  const advancedAudience = /(college|university|graduate|professional|advanced|expert|research)/.test(normalized);
  if (schoolAudience && entry.schoolFriendly) score += 8;
  if (schoolAudience && entry.source === "Khan Academy") score += 5;
  if (advancedAudience && entry.advancedFriendly) score += 6;
  return score;
}

function searchFallback(query: string, schoolAudience: boolean): RawSearchResult[] {
  const encoded = encodeURIComponent(query);
  const primary: RawSearchResult[] = schoolAudience
    ? [
        {
          title: `Search Khan Academy for ${query}`,
          url: `https://www.khanacademy.org/search?page_search_query=${encoded}`,
          source: "Khan Academy",
          snippet: "Search Khan Academy's instructional library for this concept.",
          type: "course",
        },
        {
          title: `Search MIT OpenCourseWare for ${query}`,
          url: `https://ocw.mit.edu/search/?q=${encoded}`,
          source: "MIT OpenCourseWare",
          snippet: "Search MIT's open university course materials for this concept.",
          type: "course",
        },
      ]
    : [
        {
          title: `Search MIT OpenCourseWare for ${query}`,
          url: `https://ocw.mit.edu/search/?q=${encoded}`,
          source: "MIT OpenCourseWare",
          snippet: "Search MIT's open university course materials for this concept.",
          type: "course",
        },
        {
          title: `Search Khan Academy for ${query}`,
          url: `https://www.khanacademy.org/search?page_search_query=${encoded}`,
          source: "Khan Academy",
          snippet: "Search Khan Academy's instructional library for this concept.",
          type: "course",
        },
      ];
  return primary;
}

export const institutionSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_institution_resources",
  inputSchema: InputSchema,
  async execute(input) {
    const normalized = input.query.toLowerCase();
    const schoolAudience = /(elementary|middle-school|middle school|high-school|high school|novice|beginner)/.test(normalized);
    const ranked = CATALOG
      .map((entry) => ({ entry, score: scoreEntry(entry, input.query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => {
        const { keywords: _keywords, schoolFriendly: _schoolFriendly, advancedFriendly: _advancedFriendly, ...result } = entry;
        return result;
      });

    const combined = [...ranked, ...searchFallback(input.query, schoolAudience)];
    const seen = new Set<string>();
    return combined
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, input.limit);
  },
};
