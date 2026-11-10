-- Banco separado usado pela suíte de testes de integração (npm test no backend).
-- Em produção ele existe só por compatibilidade: NUNCA rode `npm test` na VPS,
-- a suíte apaga e recria dados nesse banco.
CREATE DATABASE cobra_test OWNER cobra;
REVOKE CONNECT ON DATABASE cobra_test FROM PUBLIC;
