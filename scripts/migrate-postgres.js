import 'dotenv/config';
import { migratePostgresDatabase } from '../src/infrastructure/postgres/runMigrations.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('Defina DATABASE_URL antes de executar npm run db:migrate.\n');
  process.exitCode = 1;
} else {
  try {
    const result = await migratePostgresDatabase({ connectionString });
    process.stdout.write(
      result.applied
        ? 'Migration ' + result.version + ' aplicada com sucesso.\n'
        : 'Schema já estava atualizado (' + result.version + ').\n'
    );
  } catch {
    process.stderr.write('Não foi possível aplicar a migration PostgreSQL. Verifique a conexão e as permissões do usuário do banco.\n');
    process.exitCode = 1;
  }
}
