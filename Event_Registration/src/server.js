const config = require('./config');
const app = require('./app');

app.listen(config.PORT, () => {
  console.log(`Event Registration API running on port ${config.PORT}`);
  console.log(`Health check: http://localhost:${config.PORT}/health`);
});
