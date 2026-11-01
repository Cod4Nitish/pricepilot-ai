// Laptop/PC spec phrases (GPU, CPU, CPU generation, memory type, OS, decimals) that must NEVER be read as a
// product MODEL designator. They are extracted as specs and removed from the text used for model tokens.

export interface SpecPhrases {
  rest: string;
  /** e.g. "rtx 4050", "rtx 4070 ti" */
  gpu: string | null;
  /** e.g. "i7", "ryzen 7", "ultra 7" */
  cpuFamily: string | null;
  /** e.g. "13620h", "7840hs" */
  cpuModel: string | null;
}

/** Input should be lower-case. */
export function stripSpecPhrases(input: string): SpecPhrases {
  let t = input;
  let gpu: string | null = null;
  let cpuFamily: string | null = null;
  let cpuModel: string | null = null;

  t = t.replace(/\b(rtx|gtx|rx)\s?-?(\d{3,4})(?:\s?(ti|super|xt|xtx))?(?:\s?max-?q)?(?:\s?laptop\s?gpu)?\b/g, (_m, fam: string, num: string, suf?: string) => {
    gpu = gpu ?? `${fam} ${num}${suf ? " " + suf : ""}`;
    return " ";
  });
  t = t.replace(/\bcore\s+ultra\s+([3579])(?:\s+(\d{3}[a-z]{0,2}))?\b/g, (_m, n: string, model?: string) => {
    cpuFamily = cpuFamily ?? `ultra ${n}`;
    cpuModel = cpuModel ?? model ?? null;
    return " ";
  });
  t = t.replace(/\b(?:intel\s+)?(?:core\s+)?(i[3579])(?:[-\s]?(\d{4,5}[a-z]{0,2}))?\b/g, (_m, fam: string, model?: string) => {
    cpuFamily = cpuFamily ?? fam;
    cpuModel = cpuModel ?? model ?? null;
    return " ";
  });
  t = t.replace(/\b(?:amd\s+)?ryzen(?:\s?ai)?\s?([3579])(?:\s?(\d{4}[a-z]{0,2}))?\b/g, (_m, n: string, model?: string) => {
    cpuFamily = cpuFamily ?? `ryzen ${n}`;
    cpuModel = cpuModel ?? model ?? null;
    return " ";
  });
  t = t
    .replace(/\b\d{1,2}(?:st|nd|rd|th)[\s-]*gen(?:eration)?\b/g, " ")
    .replace(/\bl?pddr\d+x?\b|\bddr\d\b/g, " ")
    .replace(/\bwin(?:dows)?\s?\d{1,2}\b/g, " ")
    .replace(/\b\d{1,3}\.\d{1,2}\b/g, " ");
  return { rest: t.replace(/\s+/g, " ").trim(), gpu, cpuFamily, cpuModel };
}
