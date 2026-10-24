npm run seed          reset + load the synthetic world (safe while `npm run dev` is running)
npm run process       run the agent over every NEW request from the terminal (same as the queue button)
npm run demo:replay   pure engines over the workload, no DB, no model: prints the metrics
npm test              11 tests: all 8 anomalies + workload invariants

# Note: the database uses the rollback journal (not WAL) so `npm run seed` can reset data while `npm run dev` is running.
