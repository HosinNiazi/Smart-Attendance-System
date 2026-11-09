const BRAND = "4361EE";
const BRAND_DARK = "344BD1";
const INK = "1D2939";
const MUTED = "667085";
const LINE = "DCE3EF";
const SOFT = "F4F7FB";

const STATUS_STYLES = {
  "حاضر": { fill: "E9F8F1", color: "16885F" },
  "تأخیر": { fill: "FFF6E5", color: "B87A13" },
  "غایب": { fill: "FDECEC", color: "C0392B" },
  "غیبت موجه": { fill: "F3EEFE", color: "8B60DC" },
  "خروج زودهنگام": { fill: "EAF2FF", color: "2F6FED" },
  "ثبت‌نشده": { fill: "F2F4F7", color: "667085" },
};

const METHOD_LABELS = {
  manual: "ثبت دستی",
  face: "تشخیص چهره",
  voice: "تشخیص صدا",
  class_camera: "دوربین کلاس",
  fingerprint: "اثر انگشت",
  system: "خودکار",
  auto: "خودکار",
};

const BORDER = {
  top: { style: "thin", color: { rgb: LINE } },
  bottom: { style: "thin", color: { rgb: LINE } },
  left: { style: "thin", color: { rgb: LINE } },
  right: { style: "thin", color: { rgb: LINE } },
};

const baseFont = { name: "Tahoma", sz: 10, color: { rgb: INK } };
const baseAlignment = {
  horizontal: "right",
  vertical: "center",
  readingOrder: 2,
  wrapText: true,
};

const faDate = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const faNumber = (value) => Number(value || 0).toLocaleString("fa-IR");

function toJalali(isoDate) {
  if (!isoDate) return "—";
  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? isoDate : faDate.format(parsed);
}

function statusKind(status) {
  if (status === "حاضر") return "present";
  if (status === "تأخیر") return "late";
  if (status === "غیبت موجه") return "excused";
  if (status === "غایب") return "absent";
  return "other";
}

function summarize(records) {
  const counts = {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    other: 0,
  };
  for (const record of records) {
    counts[statusKind(record.status)] += 1;
  }
  const total = records.length;
  const rate = total ? Math.round((counts.present / total) * 100) : 0;
  return { ...counts, total, rate };
}

function buildDataSheet(XLSX, records, courses, filters) {
  const summary = summarize(records);
  const courseTeacher = new Map(
    (courses || []).map((course) => [course.title, course.teacher || ""]),
  );
  const columns = [
    "ردیف",
    "شماره دانشجویی",
    "نام دانشجو",
    "درس",
    "استاد",
    "تاریخ جلسه",
    "ساعت",
    "وضعیت",
    "روش ثبت",
  ];

  const filterLine = [
    `درس: ${filters.course || "همهٔ درس‌ها"}`,
    `دانشجو: ${filters.student || "همهٔ دانشجویان"}`,
    `از تاریخ: ${filters.fromDate ? toJalali(filters.fromDate) : "بدون محدودیت"}`,
    `تا تاریخ: ${filters.toDate ? toJalali(filters.toDate) : "بدون محدودیت"}`,
  ].join("   |   ");

  const summaryLine = [
    `کل رکوردها: ${faNumber(summary.total)}`,
    `حاضر: ${faNumber(summary.present)}`,
    `تأخیر: ${faNumber(summary.late)}`,
    `غایب: ${faNumber(summary.absent)}`,
    `غیبت موجه: ${faNumber(summary.excused)}`,
    `نرخ حضور: ${faNumber(summary.rate)}٪`,
  ].join("   |   ");

  const rows = [
    ["گزارش حضور و غیاب", "", "", "", "", "", "", "", ""],
    ["سامانه هوشمند حضور و غیاب — خروجی رسمی گزارش", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    [filterLine, "", "", "", "", "", "", "", ""],
    [summaryLine, "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    columns,
  ];

  records.forEach((record, index) => {
    rows.push([
      index + 1,
      String(record.id || ""),
      record.name || "",
      record.course || "",
      courseTeacher.get(record.course) || "",
      toJalali(record.sessionDate),
      record.time || "—",
      record.status || "",
      METHOD_LABELS[record.method] || record.method || "ثبت دستی",
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const lastRow = rows.length;
  const lastDataRow = lastRow;

  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 8 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 8 } },
  ];
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 30 },
    { wch: 24 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
  ];
  sheet["!rows"] = [
    { hpt: 34 },
    { hpt: 20 },
    { hpt: 10 },
    { hpt: 24 },
    { hpt: 26 },
    { hpt: 12 },
    { hpt: 30 },
  ];
  for (let row = 7; row < lastDataRow; row += 1) {
    sheet["!rows"][row] = { hpt: 24 };
  }

  // عنوان و زیرعنوان
  if (sheet.A1) {
    sheet.A1.s = {
      font: { name: "Tahoma", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: BRAND_DARK } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
    };
  }
  if (sheet.A2) {
    sheet.A2.s = {
      font: { name: "Tahoma", sz: 9, color: { rgb: "DCE4FF" } },
      fill: { fgColor: { rgb: BRAND_DARK } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
    };
  }
  if (sheet.A4) {
    sheet.A4.s = {
      font: { name: "Tahoma", sz: 9, color: { rgb: MUTED } },
      fill: { fgColor: { rgb: SOFT } },
      alignment: { horizontal: "right", vertical: "center", readingOrder: 2, wrapText: true },
      border: BORDER,
    };
  }
  if (sheet.A5) {
    sheet.A5.s = {
      font: { name: "Tahoma", sz: 9, bold: true, color: { rgb: BRAND_DARK } },
      fill: { fgColor: { rgb: "EEF2FF" } },
      alignment: { horizontal: "right", vertical: "center", readingOrder: 2, wrapText: true },
      border: { ...BORDER, bottom: { style: "medium", color: { rgb: BRAND } } },
    };
  }
  columns.forEach((_, columnIndex) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 6, c: columnIndex })];
    if (!cell) return;
    cell.s = {
      font: { name: "Tahoma", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: BRAND } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2, wrapText: true },
      border: BORDER,
    };
  });

  // داده‌ها
  for (let rowIndex = 7; rowIndex < lastDataRow; rowIndex += 1) {
    const zebra = (rowIndex - 7) % 2 === 1;
    const rowFill = zebra ? "F8FAFD" : "FFFFFF";
    const statusCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 7 })];
    const statusStyle = STATUS_STYLES[statusCell?.v] || STATUS_STYLES["ثبت‌نشده"];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) continue;
      const isStatus = columnIndex === 7;
      const isIndex = columnIndex === 0;
      const isStudentNumber = columnIndex === 1;
      cell.s = {
        font: {
          name: "Tahoma",
          sz: 9,
          bold: isStatus,
          color: { rgb: isStatus ? statusStyle.color : INK },
        },
        fill: { fgColor: { rgb: isStatus ? statusStyle.fill : rowFill } },
        alignment: {
          horizontal: isIndex ? "center" : isStatus ? "center" : "right",
          vertical: "center",
          readingOrder: 2,
          wrapText: false,
        },
        border: BORDER,
      };
      if (isStudentNumber) {
        cell.s.numFmt = "@";
        cell.v = String(cell.v || "");
      }
      if (isIndex) cell.s.numFmt = "0";
    }
  }

  sheet["!autofilter"] = {
    ref: `A7:I${Math.max(7, lastDataRow - 1)}`,
  };
  sheet["!margins"] = {
    left: 0.35,
    right: 0.35,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  };
  sheet["!printHeader"] = "&C&\"Tahoma,Bold\"&12حضوربان — گزارش حضور و غیاب";
  sheet["!printFooter"] = "&C&\"Tahoma\"&9صفحه &P از &N";

  return sheet;
}

function buildSummarySheet(XLSX, records, courses) {
  const courseTitles = [
    ...new Set(
      [
        ...(courses || []).map((course) => course.title),
        ...records.map((record) => record.course),
      ].filter(Boolean),
    ),
  ];
  const byCourse = new Map();
  for (const title of courseTitles) {
    byCourse.set(title, []);
  }
  for (const record of records) {
    const title = record.course || "بدون درس";
    if (!byCourse.has(title)) byCourse.set(title, []);
    byCourse.get(title).push(record);
  }

  const columns = [
    "درس",
    "کل رکوردها",
    "حاضر",
    "تأخیر",
    "غایب",
    "غیبت موجه",
    "نرخ حضور",
  ];
  const rows = [
    ["خلاصهٔ حضور به تفکیک درس", "", "", "", "", "", ""],
    ["سامانه هوشمند حضور و غیاب — خلاصهٔ تحلیلی", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
    columns,
  ];

  for (const [title, courseRecords] of byCourse) {
    const summary = summarize(courseRecords);
    rows.push([
      title,
      summary.total,
      summary.present,
      summary.late,
      summary.absent,
      summary.excused,
      `${faNumber(summary.rate)}٪`,
    ]);
  }

  const total = summarize(records);
  rows.push([
    "جمع کل",
    total.total,
    total.present,
    total.late,
    total.absent,
    total.excused,
    `${faNumber(total.rate)}٪`,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const lastRow = rows.length;
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];
  sheet["!cols"] = [
    { wch: 28 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 13 },
    { wch: 12 },
  ];
  sheet["!rows"] = [{ hpt: 30 }, { hpt: 18 }, { hpt: 8 }, { hpt: 26 }];
  for (let row = 4; row < lastRow; row += 1) {
    sheet["!rows"][row] = { hpt: 22 };
  }

  if (sheet.A1) {
    sheet.A1.s = {
      font: { name: "Tahoma", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: BRAND_DARK } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
    };
  }
  if (sheet.A2) {
    sheet.A2.s = {
      font: { name: "Tahoma", sz: 9, color: { rgb: "DCE4FF" } },
      fill: { fgColor: { rgb: BRAND_DARK } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
    };
  }
  columns.forEach((_, columnIndex) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 3, c: columnIndex })];
    if (!cell) return;
    cell.s = {
      font: { name: "Tahoma", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: BRAND } },
      alignment: { horizontal: "center", vertical: "center", readingOrder: 2 },
      border: BORDER,
    };
  });

  for (let rowIndex = 4; rowIndex < lastRow; rowIndex += 1) {
    const isTotal = rowIndex === lastRow - 1;
    const zebra = (rowIndex - 4) % 2 === 1;
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) continue;
      cell.s = {
        font: {
          name: "Tahoma",
          sz: 10,
          bold: isTotal || columnIndex === 0,
          color: { rgb: isTotal ? BRAND_DARK : INK },
        },
        fill: {
          fgColor: {
            rgb: isTotal ? "EEF2FF" : zebra ? "F8FAFD" : "FFFFFF",
          },
        },
        alignment: {
          horizontal: columnIndex === 0 ? "right" : "center",
          vertical: "center",
          readingOrder: 2,
        },
        border: BORDER,
      };
    }
  }

  return sheet;
}

export async function exportAttendanceExcel({
  records = [],
  courses = [],
  filters = {},
}) {
  const module = await import("xlsx-js-style");
  const XLSX = module.default || module;
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "گزارش حضور و غیاب",
    Subject: "گزارش حضور و غیاب حضوربان",
    Author: "حضوربان",
    CreatedDate: new Date(),
  };
  workbook.Workbook = {
    Views: [{ RTL: true, workbookViewId: "0" }],
  };

  const dataSheet = buildDataSheet(XLSX, records, courses, filters);
  const summarySheet = buildSummarySheet(XLSX, records, courses);
  XLSX.utils.book_append_sheet(workbook, dataSheet, "گزارش حضور");
  XLSX.utils.book_append_sheet(workbook, summarySheet, "خلاصهٔ درس‌ها");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `گزارش-حضور-غیاب-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
