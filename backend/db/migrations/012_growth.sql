-- ============================================================================
-- 012 — Horário de envio por conta, dias úteis, boleto/cartão, termos de uso,
--       primeiros passos (onboarding), e-mails do ciclo de vida e relatório mensal.
-- ============================================================================

-- Horário de envio: o motor passa a rodar de hora em hora e cada conta é
-- atendida uma vez por dia, a partir da hora escolhida (fuso do app).
-- 8 = mesmo horário de antes para todas as contas existentes.
ALTER TABLE settings
    ADD COLUMN send_hour SMALLINT NOT NULL DEFAULT 8
        CHECK (send_hour BETWEEN 6 AND 20),
    -- true = não envia mensagens em sábados, domingos e feriados nacionais.
    ADD COLUMN skip_non_business_days BOOLEAN NOT NULL DEFAULT FALSE,
    -- Resumo mensal por e-mail para o dono da conta.
    ADD COLUMN monthly_report_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Contas já atendidas pelo motor em cada dia (uma linha por conta por dia).
CREATE TABLE engine_user_runs (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ran_on      DATE NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, ran_on)
);

-- Se o ciclo de hoje já rodou (no formato antigo, 1x por dia), marca todas as
-- contas como atendidas hoje: o primeiro ciclo de hora em hora depois do
-- deploy não repete o envio do dia.
INSERT INTO engine_user_runs (user_id, ran_on)
SELECT u.id, r.ran_on
  FROM users u
 CROSS JOIN (
        SELECT ran_on FROM engine_runs
         WHERE ok AND ran_on = (now() AT TIME ZONE 'America/Sao_Paulo')::date
         LIMIT 1
      ) r
ON CONFLICT DO NOTHING;

-- Forma de pagamento da fatura. PIX = como sempre foi. BOLETO e UNDEFINED
-- (o cliente escolhe entre Pix, boleto e cartão na página do gateway) só
-- valem com o Asaas.
ALTER TABLE charges
    ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'PIX'
        CHECK (billing_type IN ('PIX', 'BOLETO', 'UNDEFINED'));

ALTER TABLE users
    -- Aceite dos Termos de Uso e da Política de Privacidade no cadastro.
    ADD COLUMN terms_accepted_at TIMESTAMPTZ,
    -- Usuário fechou o cartão "Primeiros passos" do painel.
    ADD COLUMN onboarding_dismissed_at TIMESTAMPTZ;

-- E-mails do ciclo de vida já enviados (teste acabando, teste encerrado,
-- pagamento da assinatura em atraso, resumo mensal). A PK impede reenvio:
-- ref identifica a ocorrência (data do fim do teste, id do pagamento, mês).
CREATE TABLE lifecycle_emails (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    ref     TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, ref)
);
