import { inflateSync } from "node:zlib";

interface PdfToken {
  order: number;
  x: number;
  y: number;
  text: string;
}

export interface ParsedScheduleCourse {
  name: string;
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity?: "odd" | "even";
  classroom?: string;
  teacher?: string;
  teachingClasses?: string;
}

export interface ParsedSchedulePdf {
  name: string;
  studentNo?: string;
  courses: ParsedScheduleCourse[];
}

const COLUMN_X = [104.08, 207.92, 311.77, 415.62, 519.46, 623.31, 727.15];

const dayForX = (x: number): number | null => {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  COLUMN_X.forEach((value, index) => {
    const distance = Math.abs(value - x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  if (nearestDistance <= 4) {
    return nearestIndex + 1;
  }
  return null;
};

const unescapePdfLiteral = (raw: Uint8Array) => {
  const output: number[] = [];
  let index = 0;
  while (index < raw.length) {
    const current = raw[index];
    if (current !== 92) {
      output.push(current);
      index += 1;
      continue;
    }
    index += 1;
    if (index >= raw.length) {
      break;
    }
    const escaped = raw[index];
    if (escaped === 110) {
      output.push(10);
      index += 1;
      continue;
    }
    if (escaped === 114) {
      output.push(13);
      index += 1;
      continue;
    }
    if (escaped === 116) {
      output.push(9);
      index += 1;
      continue;
    }
    if (escaped === 98) {
      output.push(8);
      index += 1;
      continue;
    }
    if (escaped === 102) {
      output.push(12);
      index += 1;
      continue;
    }
    if (escaped === 40 || escaped === 41 || escaped === 92) {
      output.push(escaped);
      index += 1;
      continue;
    }
    if (escaped >= 48 && escaped <= 55) {
      const octDigits = [escaped];
      index += 1;
      for (let loop = 0; loop < 2; loop += 1) {
        if (index < raw.length && raw[index] >= 48 && raw[index] <= 55) {
          octDigits.push(raw[index]);
          index += 1;
        } else {
          break;
        }
      }
      const value = Number.parseInt(String.fromCharCode(...octDigits), 8);
      output.push(Number.isFinite(value) ? value : escaped);
      continue;
    }
    if (escaped === 10 || escaped === 13) {
      if (escaped === 13 && index + 1 < raw.length && raw[index + 1] === 10) {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    output.push(escaped);
    index += 1;
  }
  return Uint8Array.from(output);
};

const decodeTextBytes = (raw: Uint8Array) => {
  if (raw.length <= 0) {
    return "";
  }
  if (raw.length % 2 === 0) {
    try {
      return new TextDecoder("utf-16be", { fatal: true }).decode(raw);
    } catch {
      // fallback below
    }
  }
  for (const encoding of ["utf-8", "gb18030", "latin1"] as const) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(raw);
    } catch {
      // next fallback
    }
  }
  return "";
};

const looksLikeTitle = (text: string) => {
  if (!text || text.length > 40) {
    return false;
  }
  if (["上午", "下午", "晚上", "理论", "实验", "实践"].includes(text)) {
    return false;
  }
  if (/^\d{1,2}$/.test(text)) {
    return false;
  }
  if (text.startsWith(":")) {
    return false;
  }
  if (/(校区|场地|教师|教学班|周学时|组成|打印时间|学号|学期|课表)/.test(text)) {
    return false;
  }
  if (/[/:;]/.test(text)) {
    return false;
  }
  if (/20\d{2}|\d+\)|\(\d+\)/.test(text)) {
    return false;
  }
  return /[A-Za-z\u4e00-\u9fff+]/.test(text);
};

const decodeLatin1 = (value: string) => {
  return Uint8Array.from(Buffer.from(value, "latin1"));
};

const extractTokens = (pdfBytes: Uint8Array): PdfToken[] => {
  const content = Buffer.from(pdfBytes);
  const contentText = content.toString("latin1");
  const streamRegex = /stream\r?\n/g;
  const tokens: PdfToken[] = [];
  let order = 0;
  let streamMatch: RegExpExecArray | null = null;
  while ((streamMatch = streamRegex.exec(contentText)) !== null) {
    const bodyStart = streamMatch.index + streamMatch[0].length;
    const endIndex = contentText.indexOf("endstream", bodyStart);
    if (endIndex < 0) {
      continue;
    }
    const compressed = content.subarray(bodyStart, endIndex);
    const trimmed = compressed.subarray(0, compressed.length > 0 && (compressed[compressed.length - 1] === 10 || compressed[compressed.length - 1] === 13) ? compressed.length - 1 : compressed.length);
    let streamBody: Buffer;
    try {
      streamBody = inflateSync(trimmed);
    } catch {
      continue;
    }

    let x = 0;
    let y = 0;
    const lines = streamBody.toString("latin1").split(/\r?\n/);
    for (const line of lines) {
      const position = /1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/.exec(line);
      if (position) {
        x = Number(position[1]) || 0;
        y = Number(position[2]) || 0;
      }
      const textRegex = /\((.*?)\)\s*Tj/g;
      let textMatch: RegExpExecArray | null = null;
      while ((textMatch = textRegex.exec(line)) !== null) {
        const raw = unescapePdfLiteral(decodeLatin1(textMatch[1]));
        const text = decodeTextBytes(raw).replace(/\u0000/g, "").replace(/\r/g, "").replace(/\n/g, "").trim();
        if (!text) {
          continue;
        }
        tokens.push({
          order,
          x,
          y,
          text,
        });
        order += 1;
      }
    }
  }
  return tokens;
};

export const parseSchedulePdf = (pdfBytes: Uint8Array): ParsedSchedulePdf => {
  const tokens = extractTokens(pdfBytes);
  let owner = "";
  let studentNo = "";
  for (const token of tokens) {
    if (token.text.endsWith("课表") && token.text.length <= 20) {
      owner = token.text.replace(/课表$/, "");
    }
    const match = /学号[:：]\s*(\d{6,32})/.exec(token.text);
    if (match) {
      studentNo = String(match[1] || "").trim();
    }
    if (owner && studentNo) {
      break;
    }
  }
  const byDay = new Map<number, PdfToken[]>();
  for (let day = 1; day <= 7; day += 1) {
    byDay.set(day, []);
  }
  for (const token of tokens) {
    const day = dayForX(token.x);
    if (!day) {
      continue;
    }
    if (!(token.y > 10 && token.y < 580)) {
      continue;
    }
    byDay.get(day)?.push(token);
  }

  const courses: ParsedScheduleCourse[] = [];
  const detailPattern = /^\((\d+)-(\d+)节\)([^/]*?)周(?:\((单|双)\))?/;
  for (let day = 1; day <= 7; day += 1) {
    const dayTokens = [...(byDay.get(day) || [])].sort((left, right) => left.order - right.order);
    const titleLines: string[] = [];
    let index = 0;
    while (index < dayTokens.length) {
      const text = dayTokens[index].text;
      const detail = detailPattern.exec(text);
      if (!detail) {
        if (looksLikeTitle(text)) {
          titleLines.push(text);
        }
        index += 1;
        continue;
      }
      const title = titleLines.join("").trim();
      titleLines.length = 0;
      if (!title) {
        index += 1;
        continue;
      }
      let detailBlob = text;
      let nextIndex = index + 1;
      while (nextIndex < dayTokens.length) {
        const candidate = dayTokens[nextIndex].text;
        if (detailPattern.test(candidate) || looksLikeTitle(candidate)) {
          break;
        }
        detailBlob += candidate;
        if (detailBlob.includes("周学时")) {
          nextIndex += 1;
          break;
        }
        nextIndex += 1;
      }
      const course: ParsedScheduleCourse = {
        name: title,
        day,
        startSection: Number(detail[1]) || 0,
        endSection: Number(detail[2]) || 0,
        weekExpr: String(detail[3] || "").trim(),
      };
      if (detail[4] === "单") {
        course.parity = "odd";
      } else if (detail[4] === "双") {
        course.parity = "even";
      }
      const classroom = /场地:([^/]+)/.exec(detailBlob);
      if (classroom) {
        course.classroom = String(classroom[1] || "").trim();
      }
      const teacher = /教师:([^/]+)/.exec(detailBlob);
      if (teacher) {
        course.teacher = String(teacher[1] || "").trim();
      }
      const teachingClasses = /教学班组成:([^/]+)/.exec(detailBlob);
      if (teachingClasses) {
        course.teachingClasses = String(teachingClasses[1] || "").trim();
      }
      courses.push(course);
      index = nextIndex;
    }
  }
  return {
    name: owner,
    studentNo,
    courses,
  };
};
