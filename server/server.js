require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true,
}));

app.use('/api/companies',         require('./routes/companies'));
app.use('/api/stations',          require('./routes/stations'));
app.use('/api/users',             require('./routes/users'));
app.use('/api/situation',         require('./routes/situation'));
app.use('/api/daily-reports',     require('./routes/dailyReports'));
app.use('/api/payments',          require('./routes/payments'));
app.use('/api/fiche',             require('./routes/fiche'));
app.use('/api/loans',             require('./routes/loans'));
app.use('/api/stock',             require('./routes/stock'));
app.use('/api/stock-daily',       require('./routes/stockDaily'));
app.use('/api/gain-pompiste',     require('./routes/gainPompiste'));
app.use('/api/customers',         require('./routes/customers'));
app.use('/api/station-managers',  require('./routes/stationManagers'));
app.use('/api/fuel-prices',       require('./routes/fuelPriceHistory'));
app.use('/api/pumps',             require('./routes/pumps'));
app.use('/api/nozzles',           require('./routes/nozzles'));
app.use('/api/nozzle-readings',   require('./routes/nozzleReadings'));
app.use('/api/teams',             require('./routes/authAppwrite/teams'));
app.use('/api/accounts',          require('./routes/authAppwrite/accounts'));
app.use('/api/bonuses',           require('./routes/bonuses'));

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
