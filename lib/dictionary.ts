import type {
  DictionaryEntry,
  DictionaryExample,
  LemmaResult,
  PartOfSpeech,
} from "./types.ts";

interface LegacyCuratedEntry {
  lemma: string;
  partOfSpeech: PartOfSpeech;
  zh: string;
  es: string;
  examples: Array<Required<Pick<DictionaryExample, "ca" | "zh">>>;
}

const LEGACY_CURATED_DICTIONARY: Record<string, LegacyCuratedEntry> = {
  pujar: {
    lemma: "pujar",
    partOfSpeech: "verb",
    zh: "上去；上升；提高",
    es: "subir",
    examples: [
      { ca: "Està pujant les escales.", zh: "他正在上楼梯。" },
      { ca: "Els preus han pujat aquest any.", zh: "今年价格上涨了。" },
      { ca: "He de pujar al segon pis.", zh: "我得上二楼。" },
    ],
  },
  anar: {
    lemma: "anar",
    partOfSpeech: "verb",
    zh: "去；前往",
    es: "ir",
    examples: [
      { ca: "Avui vaig a la universitat.", zh: "我今天去大学。" },
      { ca: "Demà anem al mercat.", zh: "明天我们去市场。" },
    ],
  },
  fer: {
    lemma: "fer",
    partOfSpeech: "verb",
    zh: "做；制作；使",
    es: "hacer",
    examples: [
      { ca: "Què fas aquest vespre?", zh: "你今晚做什么？" },
      { ca: "Fem una pausa?", zh: "我们休息一下好吗？" },
    ],
  },
  tenir: {
    lemma: "tenir",
    partOfSpeech: "verb",
    zh: "有；拥有",
    es: "tener",
    examples: [
      { ca: "Tinc classe a les deu.", zh: "我十点有课。" },
      { ca: "Tenia molta gana.", zh: "我当时很饿。" },
    ],
  },
  ser: {
    lemma: "ser",
    partOfSpeech: "verb",
    zh: "是",
    es: "ser",
    examples: [
      { ca: "Soc estudiant de la UPC.", zh: "我是 UPC 的学生。" },
      { ca: "Barcelona és una ciutat oberta.", zh: "巴塞罗那是一座开放的城市。" },
    ],
  },
  haver: {
    lemma: "haver",
    partOfSpeech: "verb",
    zh: "有；助动词",
    es: "haber",
    examples: [
      { ca: "He acabat la feina.", zh: "我完成工作了。" },
      { ca: "Hi ha una farmàcia a prop?", zh: "附近有药店吗？" },
    ],
  },
  voler: {
    lemma: "voler",
    partOfSpeech: "verb",
    zh: "想；想要",
    es: "querer",
    examples: [
      { ca: "Vull un cafè amb llet.", zh: "我想要一杯牛奶咖啡。" },
      { ca: "Vols venir amb nosaltres?", zh: "你想和我们一起去吗？" },
    ],
  },
  poder: {
    lemma: "poder",
    partOfSpeech: "verb",
    zh: "能够；可以",
    es: "poder",
    examples: [
      { ca: "Puc pagar amb targeta?", zh: "我可以刷卡吗？" },
      { ca: "No podem entrar encara.", zh: "我们还不能进去。" },
    ],
  },
  dir: {
    lemma: "dir",
    partOfSpeech: "verb",
    zh: "说；告诉",
    es: "decir",
    examples: [
      { ca: "Com et dius?", zh: "你叫什么名字？" },
      { ca: "La professora diu que demà no hi ha classe.", zh: "老师说明天没有课。" },
    ],
  },
  renyar: {
    lemma: "renyar",
    partOfSpeech: "verb",
    zh: "责骂；批评",
    es: "reñir / regañar",
    examples: [
      { ca: "La professora m'ha renyat.", zh: "老师批评了我。" },
      { ca: "No vull que em tornin a renyar.", zh: "我不想他们再责骂我。" },
    ],
  },
  tornar: {
    lemma: "tornar",
    partOfSpeech: "verb",
    zh: "返回；再次",
    es: "volver",
    examples: [
      { ca: "Tornem a casa en metro.", zh: "我们坐地铁回家。" },
      { ca: "Espero que tornin aviat.", zh: "我希望他们很快回来。" },
    ],
  },
  casa: {
    lemma: "casa",
    partOfSpeech: "noun",
    zh: "房子；家",
    es: "casa",
    examples: [
      { ca: "Visc en una casa petita.", zh: "我住在一间小房子里。" },
      { ca: "Les cases d'aquest carrer són antigues.", zh: "这条街上的房子很老。" },
    ],
  },
  casar: {
    lemma: "casar",
    partOfSpeech: "verb",
    zh: "结婚；嫁娶",
    es: "casar(se)",
    examples: [
      { ca: "Es casen al setembre.", zh: "他们九月结婚。" },
      { ca: "No crec que et cases tan aviat.", zh: "我觉得你不会这么早结婚。" },
    ],
  },
  petit: {
    lemma: "petit",
    partOfSpeech: "adjective",
    zh: "小的",
    es: "pequeño",
    examples: [
      { ca: "Tinc una habitació petita.", zh: "我的房间很小。" },
      { ca: "Les botigues petites tanquen aviat.", zh: "小商店很早关门。" },
    ],
  },
  "conèixer": {
    lemma: "conèixer",
    partOfSpeech: "verb",
    zh: "认识；了解",
    es: "conocer",
    examples: [
      { ca: "Coneixes aquest barri?", zh: "你熟悉这个街区吗？" },
      { ca: "Vull conèixer millor la ciutat.", zh: "我想更好地了解这座城市。" },
    ],
  },
  cantonada: {
    lemma: "cantonada",
    partOfSpeech: "noun",
    zh: "街角；拐角",
    es: "esquina",
    examples: [
      { ca: "El forn és a la cantonada.", zh: "面包店在街角。" },
      { ca: "Gira a la dreta a la pròxima cantonada.", zh: "在下一个路口右转。" },
    ],
  },
  mateix: {
    lemma: "mateix",
    partOfSpeech: "adjective",
    zh: "相同的；自己",
    es: "mismo",
    examples: [
      { ca: "Vivim al mateix carrer.", zh: "我们住在同一条街。" },
      { ca: "Ho faré jo mateix.", zh: "我自己来做。" },
    ],
  },
  agafar: {
    lemma: "agafar",
    partOfSpeech: "verb",
    zh: "拿；抓；乘坐",
    es: "coger / tomar",
    examples: [
      { ca: "Agafo el metro a Sants.", zh: "我在 Sants 坐地铁。" },
      { ca: "Agafa un paraigua.", zh: "带把伞吧。" },
    ],
  },
  escola: {
    lemma: "escola",
    partOfSpeech: "noun",
    zh: "学校",
    es: "escuela",
    examples: [
      { ca: "L'escola és al costat del parc.", zh: "学校在公园旁边。" },
      { ca: "Avui els nens no tenen escola.", zh: "孩子们今天不上学。" },
    ],
  },
  carrer: {
    lemma: "carrer",
    partOfSpeech: "noun",
    zh: "街道",
    es: "calle",
    examples: [
      { ca: "Aquest carrer és molt tranquil.", zh: "这条街很安静。" },
      { ca: "Ens veiem al carrer de Mallorca.", zh: "我们在 Mallorca 街见。" },
    ],
  },
  barri: {
    lemma: "barri",
    partOfSpeech: "noun",
    zh: "街区；社区",
    es: "barrio",
    examples: [
      { ca: "Gràcia és un barri de Barcelona.", zh: "Gràcia 是巴塞罗那的一个街区。" },
      { ca: "Hi ha molts cafès al barri.", zh: "这个社区有很多咖啡馆。" },
    ],
  },
  classe: {
    lemma: "classe",
    partOfSpeech: "noun",
    zh: "课；班级",
    es: "clase",
    examples: [
      { ca: "La classe comença a les nou.", zh: "课程九点开始。" },
      { ca: "Avui tenim classe de català.", zh: "我们今天有加泰罗尼亚语课。" },
    ],
  },
  metro: {
    lemma: "metro",
    partOfSpeech: "noun",
    zh: "地铁；米",
    es: "metro",
    examples: [
      { ca: "Vaig a la feina en metro.", zh: "我坐地铁去上班。" },
      { ca: "On és l'entrada del metro?", zh: "地铁入口在哪里？" },
    ],
  },
  venir: {
    lemma: "venir",
    partOfSpeech: "verb",
    zh: "来；到来",
    es: "venir",
    examples: [
      { ca: "Vens a sopar aquesta nit?", zh: "你今晚来吃晚饭吗？" },
      { ca: "Els meus amics venen demà.", zh: "我的朋友们明天来。" },
    ],
  },
  sortir: {
    lemma: "sortir",
    partOfSpeech: "verb",
    zh: "出去；离开",
    es: "salir",
    examples: [
      { ca: "Surto de casa a les vuit.", zh: "我八点出门。" },
      { ca: "Sortim per la porta principal.", zh: "我们从正门出去。" },
    ],
  },
  menjar: {
    lemma: "menjar",
    partOfSpeech: "verb",
    zh: "吃；食物",
    es: "comer / comida",
    examples: [
      { ca: "Què vols menjar?", zh: "你想吃什么？" },
      { ca: "Mengem a la una.", zh: "我们一点吃饭。" },
    ],
  },
  beure: {
    lemma: "beure",
    partOfSpeech: "verb",
    zh: "喝",
    es: "beber",
    examples: [
      { ca: "Vols beure aigua?", zh: "你想喝水吗？" },
      { ca: "Bec cafè sense sucre.", zh: "我喝不加糖的咖啡。" },
    ],
  },
  "gràcies": {
    lemma: "gràcies",
    partOfSpeech: "expression",
    zh: "谢谢",
    es: "gracias",
    examples: [
      { ca: "Moltes gràcies per l'ajuda.", zh: "非常感谢你的帮助。" },
      { ca: "Gràcies, fins demà!", zh: "谢谢，明天见！" },
    ],
  },
  "si us plau": {
    lemma: "si us plau",
    partOfSpeech: "expression",
    zh: "请",
    es: "por favor",
    examples: [
      { ca: "Un cafè, si us plau.", zh: "请给我一杯咖啡。" },
      { ca: "Parla més a poc a poc, si us plau.", zh: "请说慢一点。" },
    ],
  },
  "me'n": {
    lemma: "me'n",
    partOfSpeech: "pronoun",
    zh: "我从中；我离开（代词组合）",
    es: "me ... / me voy",
    examples: [
      { ca: "Me'n vaig a casa.", zh: "我要回家了。" },
      { ca: "Me'n pots donar dos?", zh: "你能给我两个吗？" },
    ],
  },
};

/**
 * Small, human-reviewed quality overlay. The large generated dictionary is
 * loaded from static shards; these records deliberately remain in the client
 * bundle so the most important meanings and examples are always available.
 */
export const DICTIONARY: Record<string, DictionaryEntry> = Object.fromEntries(
  Object.entries(LEGACY_CURATED_DICTIONARY).map(([key, entry]) => [
    key,
    {
      lemma: entry.lemma,
      normalizedLemma: key,
      partOfSpeech: [entry.partOfSpeech],
      chinese: entry.zh.split(/\s*[；]\s*/).filter(Boolean),
      spanish: entry.es.split(/\s*[/]\s*/).filter(Boolean),
      examples: entry.examples,
      source: ["project-curated"],
      provenance: [
        {
          sourceId: "project-curated",
          fields: ["chinese", "spanish", "examples"],
        },
      ],
    } satisfies DictionaryEntry,
  ]),
);

/**
 * Compact form → lemma seed index. It deliberately records irregular and
 * high-frequency forms explicitly instead of guessing by removing suffixes.
 */
export const FORM_INDEX: Record<string, LemmaResult[]> = {
  vaig: [{ input: "vaig", lemma: "anar", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  vas: [{ input: "vas", lemma: "anar", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  va: [{ input: "va", lemma: "anar", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  anem: [{ input: "anem", lemma: "anar", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 1 }],
  anava: [{ input: "anava", lemma: "anar", partOfSpeech: "verb", morphology: "imperfect · 1st/3rd person singular", confidence: 1 }],
  anat: [{ input: "anat", lemma: "anar", partOfSpeech: "verb", morphology: "past participle", confidence: 0.99 }],
  faig: [{ input: "faig", lemma: "fer", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  fas: [{ input: "fas", lemma: "fer", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  fa: [{ input: "fa", lemma: "fer", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  fem: [{ input: "fem", lemma: "fer", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 1 }],
  fes: [{ input: "fes", lemma: "fer", partOfSpeech: "verb", morphology: "imperative · 2nd person singular", confidence: 0.99 }],
  fet: [{ input: "fet", lemma: "fer", partOfSpeech: "verb", morphology: "past participle", confidence: 0.99 }],
  tinc: [{ input: "tinc", lemma: "tenir", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  tens: [{ input: "tens", lemma: "tenir", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  té: [{ input: "té", lemma: "tenir", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  tenim: [{ input: "tenim", lemma: "tenir", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  tenia: [{ input: "tenia", lemma: "tenir", partOfSpeech: "verb", morphology: "imperfect · 1st/3rd person singular", confidence: 1 }],
  soc: [{ input: "soc", lemma: "ser", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  sóc: [{ input: "sóc", lemma: "ser", partOfSpeech: "verb", morphology: "legacy spelling · present · 1st person singular", confidence: 0.98 }],
  ets: [{ input: "ets", lemma: "ser", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  és: [{ input: "és", lemma: "ser", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  som: [{ input: "som", lemma: "ser", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  he: [{ input: "he", lemma: "haver", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  ha: [{ input: "ha", lemma: "haver", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  hem: [{ input: "hem", lemma: "haver", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  vull: [{ input: "vull", lemma: "voler", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  vols: [{ input: "vols", lemma: "voler", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  vol: [{ input: "vol", lemma: "voler", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  puc: [{ input: "puc", lemma: "poder", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  pots: [{ input: "pots", lemma: "poder", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  pot: [{ input: "pot", lemma: "poder", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  podem: [{ input: "podem", lemma: "poder", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  dic: [{ input: "dic", lemma: "dir", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 1 }],
  dius: [{ input: "dius", lemma: "dir", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  diu: [{ input: "diu", lemma: "dir", partOfSpeech: "verb", morphology: "present · 3rd person singular", confidence: 0.99 }],
  pujant: [{ input: "pujant", lemma: "pujar", partOfSpeech: "verb", morphology: "gerund", confidence: 1 }],
  pujat: [{ input: "pujat", lemma: "pujar", partOfSpeech: "verb", morphology: "past participle", confidence: 0.99 }],
  pujarem: [{ input: "pujarem", lemma: "pujar", partOfSpeech: "verb", morphology: "future · 1st person plural", confidence: 1 }],
  puja: [{ input: "puja", lemma: "pujar", partOfSpeech: "verb", morphology: "present · 3rd person singular / imperative", confidence: 0.98 }],
  renyin: [{ input: "renyin", lemma: "renyar", partOfSpeech: "verb", morphology: "present subjunctive · 3rd person plural", confidence: 1 }],
  renyat: [{ input: "renyat", lemma: "renyar", partOfSpeech: "verb", morphology: "past participle", confidence: 0.99 }],
  tornin: [{ input: "tornin", lemma: "tornar", partOfSpeech: "verb", morphology: "present subjunctive · 3rd person plural", confidence: 1 }],
  tornem: [{ input: "tornem", lemma: "tornar", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  cases: [
    { input: "cases", lemma: "casa", partOfSpeech: "noun", morphology: "feminine plural", confidence: 0.99 },
    { input: "cases", lemma: "casar", partOfSpeech: "verb", morphology: "present indicative · 2nd person singular", confidence: 0.72 },
  ],
  petita: [{ input: "petita", lemma: "petit", partOfSpeech: "adjective", morphology: "feminine singular", confidence: 1 }],
  petits: [{ input: "petits", lemma: "petit", partOfSpeech: "adjective", morphology: "masculine plural", confidence: 0.99 }],
  petites: [{ input: "petites", lemma: "petit", partOfSpeech: "adjective", morphology: "feminine plural", confidence: 1 }],
  mateixa: [{ input: "mateixa", lemma: "mateix", partOfSpeech: "adjective", morphology: "feminine singular", confidence: 0.99 }],
  mateixos: [{ input: "mateixos", lemma: "mateix", partOfSpeech: "adjective", morphology: "masculine plural", confidence: 0.99 }],
  mateixes: [{ input: "mateixes", lemma: "mateix", partOfSpeech: "adjective", morphology: "feminine plural", confidence: 0.99 }],
  "l'escola": [{ input: "l'escola", lemma: "escola", partOfSpeech: "noun", morphology: "definite article + noun", confidence: 1 }],
  vinc: [{ input: "vinc", lemma: "venir", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 0.99 }],
  vens: [{ input: "vens", lemma: "venir", partOfSpeech: "verb", morphology: "present · 2nd person singular", confidence: 0.99 }],
  venen: [{ input: "venen", lemma: "venir", partOfSpeech: "verb", morphology: "present · 3rd person plural", confidence: 0.99 }],
  surto: [{ input: "surto", lemma: "sortir", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 0.99 }],
  sortim: [{ input: "sortim", lemma: "sortir", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  mengem: [{ input: "mengem", lemma: "menjar", partOfSpeech: "verb", morphology: "present · 1st person plural", confidence: 0.99 }],
  bec: [{ input: "bec", lemma: "beure", partOfSpeech: "verb", morphology: "present · 1st person singular", confidence: 0.99 }],
};

export const POPULAR_SEARCHES = ["pujant", "vaig", "renyin", "cases"] as const;

