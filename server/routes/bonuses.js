const express  = require('express');
const router    = express.Router();
const multer    = require('multer');
const XLSX      = require('xlsx');
const ExcelJS   = require('exceljs');
const { verifyJWT, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_PAYMENTS  = ['CASH', 'MTN MOMO', 'BANK CARD'];
const MIN_AMOUNT      = 400_000;
const CUSTOMER_PREFIX = ['1', '7'];

// POST /api/bonuses/filter
router.post('/filter', verifyJWT, requireRole(['owner', 'manager']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Send an xlsx file in the "file" field.' });

    // 1. Read uploaded Excel (header on row 2)
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '', range: 1 });

    // 2. Filter rows
    const filtered = rows.filter(r => {
      const payment  = String(r['Payment']  || '').trim();
      const customer = String(r['Customer'] || '').trim();
      return VALID_PAYMENTS.includes(payment) &&
             CUSTOMER_PREFIX.some(p => customer.startsWith(p));
    });

    // 3. Group by Customer, sum Amount
    const totals = {};
    filtered.forEach(r => {
      const customer = String(r['Customer']).trim();
      const rawAmt   = r['Amount'] ?? r[' Amount '] ?? r['AMOUNT'] ?? 0;
      const amount   = parseFloat(String(rawAmt).replace(/[,\s]/g, '')) || 0;
      totals[customer] = (totals[customer] || 0) + amount;
    });

    // 4. Keep only >= 400,000 RWF, sort by customer
    const summary = Object.entries(totals)
      .filter(([, amt]) => amt >= MIN_AMOUNT)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([customer, total]) => ({ customer, total: Math.round(total) }));

    if (!summary.length) {
      return res.status(200).json({ message: 'No customers met the 400,000 RWF threshold.', count: 0 });
    }

    // 5a. JSON preview mode — return data without generating Excel
    const wantsJson = (req.headers['accept'] || '').includes('application/json');
    if (wantsJson) {
      return res.json({
        summary,
        count:       summary.length,
        totalAmount: summary.reduce((s, r) => s + r.total, 0),
      });
    }

    // 5b. Build formatted output Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Summary');

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B263B' } };
    const headerFont = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    const dataFont   = { name: 'Arial', size: 10 };
    const boldFont   = { name: 'Arial', bold: true, size: 10 };
    const thinBorder = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
    const center     = { horizontal: 'center', vertical: 'middle' };
    const right      = { horizontal: 'right',  vertical: 'middle' };

    ws.columns = [
      { key: 'customer', width: 22 },
      { key: 'total',    width: 24 },
    ];

    // Header row
    const hRow = ws.addRow(['Customer', 'Total Amount']);
    hRow.height = 20;
    hRow.eachCell(cell => {
      cell.font = headerFont; cell.fill = headerFill;
      cell.alignment = center; cell.border = allBorders;
    });

    // Data rows
    summary.forEach(({ customer, total }) => {
      const row = ws.addRow([customer, total]);
      row.getCell(1).font = dataFont; row.getCell(1).alignment = center; row.getCell(1).border = allBorders;
      row.getCell(2).font = dataFont; row.getCell(2).alignment = right;  row.getCell(2).border = allBorders;
      row.getCell(2).numFmt = '#,##0';
    });

    // Total row
    const totalRow = ws.addRow(['TOTAL', summary.reduce((s, r) => s + r.total, 0)]);
    totalRow.getCell(1).font = boldFont; totalRow.getCell(1).alignment = center; totalRow.getCell(1).border = allBorders;
    totalRow.getCell(2).font = boldFont; totalRow.getCell(2).alignment = right;  totalRow.getCell(2).border = allBorders;
    totalRow.getCell(2).numFmt = '#,##0';

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // 6. Send as download
    const originalName = (req.file.originalname || 'file').replace(/\.xlsx$/i, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${originalName} Bonus.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('bonuses/filter error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
