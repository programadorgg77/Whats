# WhatsApp Bot - Funil de Vendas

## ⚠️ ANTES DE FAZER DEPLOY

Substitua o arquivo `audio4.ogg` pelo seu áudio real antes de subir para o GitHub/servidor.

## Estrutura da Planilha Google Sheets

| Coluna A | Coluna B | Coluna C | Coluna D | Coluna E |
|----------|----------|----------|----------|----------|
| Nome Empresa | Telefone | Status | Etapa | Último Contato |
| Lash Studio SP | 11999990000 | NAO_INICIADO | 0 | |

### Status possíveis
- `NAO_INICIADO` → bot vai abordar
- `AGUARDANDO_RESPOSTA` → aguardando lead responder
- `CONVERTIDO` → funil completo
- `ERRO` → falhou ao enviar
