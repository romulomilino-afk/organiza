/**
 * Organiza — schema do banco (PostgreSQL, Drizzle ORM)
 *
 * Regras:
 * - Toda tabela com dados do usuário tem `user_id`, índice e exclusão em cascata.
 * - Dinheiro em centavos (integer). Datas de calendário como DATE ("YYYY-MM-DD"),
 *   horários como texto "HH:MM" no fuso do usuário.
 */
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, date, jsonb, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const userId = () => text("user_id").notNull().references(() => users.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date());

// ─────────────── Enums ───────────────
export const planEnum = pgEnum("plan", ["FREE", "PREMIUM", "FAMILY"]);
export const roleEnum = pgEnum("message_role", ["USER", "ASSISTANT"]);
export const sourceEnum = pgEnum("message_source", ["TEXT", "VOICE", "SYSTEM"]);
export const suggestionStateEnum = pgEnum("suggestion_state", ["PENDING", "ACCEPTED", "DECLINED"]);
export const taskStatusEnum = pgEnum("task_status", ["OPEN", "DONE"]);
export const recurrenceEnum = pgEnum("recurrence", ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
export const categoryKindEnum = pgEnum("category_kind", ["EXPENSE", "INCOME"]);
export const paymentMethodEnum = pgEnum("payment_method", ["CARTAO", "PIX", "DINHEIRO", "DEBITO", "BOLETO"]);
export const expenseStatusEnum = pgEnum("expense_status", ["PAID", "PENDING"]);
export const billingCycleEnum = pgEnum("billing_cycle", ["MONTHLY", "YEARLY"]);
export const documentCategoryEnum = pgEnum("document_category", ["NOTA_FISCAL", "DOCUMENTO", "CONTRATO", "GARANTIA", "MANUAL", "OUTRO"]);
export const recurringKindEnum = pgEnum("recurring_kind", ["BILL", "EXPENSE", "INCOME"]);
export const householdRoleEnum = pgEnum("household_role", ["OWNER", "MEMBER"]);
export const billingStatusEnum = pgEnum("billing_status", ["PENDING", "ACTIVE", "OVERDUE", "CANCELED"]);

// ─────────────── Usuários e autenticação (formato do Auth.js) ───────────────
export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  plan: planEnum("plan").notNull().default("FREE"),
  onboarded: boolean("onboarded").notNull().default(false),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  asaasCustomerId: text("asaas_customer_id"),
  phone: text("phone").unique(),                 // WhatsApp vinculado, formato E.164 sem "+"
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable("accounts", {
  userId: userId(),
  type: text("type").$type<AdapterAccountType>().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: userId(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

export const userPreferences = pgTable("user_preferences", {
  id: id(),
  userId: userId().unique(),
  focus: text("focus").array().notNull().default([]),
  defaultRemindDays: integer("default_remind_days").default(1),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  quietHoursStart: text("quiet_hours_start").default("22:00"),
  quietHoursEnd: text("quiet_hours_end").default("07:00"),
  updatedAt: updatedAt(),
});

// ─────────────── Conversa com a Nina ───────────────
export const conversations = pgTable("conversations", {
  id: id(),
  userId: userId(),
  title: text("title").notNull().default("Conversa com a Nina"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)]);

export const messages = pgTable("messages", {
  id: id(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: userId(),
  role: roleEnum("role").notNull(),
  source: sourceEnum("source").notNull().default("TEXT"),
  content: text("content").notNull(),
  actions: jsonb("actions"),        // intenções validadas e executadas
  cards: jsonb("cards"),            // cartões de confirmação exibidos
  suggestion: jsonb("suggestion"),  // oferta; executada só no servidor
  suggestionState: suggestionStateEnum("suggestion_state"),
  createdAt: createdAt(),
}, (t) => [
  index("messages_conversation_idx").on(t.conversationId, t.createdAt),
  index("messages_user_idx").on(t.userId, t.createdAt),
]);

// ─────────────── Organização ───────────────
export const tasks = pgTable("tasks", {
  id: id(),
  userId: userId(),
  title: text("title").notNull(),
  notes: text("notes"),
  dueDate: date("due_date", { mode: "string" }),
  status: taskStatusEnum("status").notNull().default("OPEN"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }), // compartilhado com a família
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("tasks_user_idx").on(t.userId, t.status, t.dueDate)]);

export const events = pgTable("events", {
  id: id(),
  userId: userId(),
  title: text("title").notNull(),
  notes: text("notes"),
  location: text("location"),
  date: date("date", { mode: "string" }).notNull(),     // início / 1ª ocorrência
  time: text("time"),                                   // "HH:MM"; null = dia todo
  recurrence: recurrenceEnum("recurrence").notNull().default("NONE"),
  interval: integer("interval").notNull().default(1),
  until: date("until", { mode: "string" }),
  skipDates: text("skip_dates").array().notNull().default([]),
  remindDaysBefore: integer("remind_days_before"),
  cancelled: boolean("cancelled").notNull().default(false),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }), // compartilhado com a família
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("events_user_idx").on(t.userId, t.date)]);

export const reminders = pgTable("reminders", {
  id: id(),
  userId: userId(),
  text: text("text").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  time: text("time"),
  done: boolean("done").notNull().default(false),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("reminders_user_idx").on(t.userId, t.done, t.date)]);

// ─────────────── Financeiro ───────────────
export const categories = pgTable("categories", {
  id: id(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // null = padrão do sistema
  key: text("key").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  kind: categoryKindEnum("kind").notNull(),
  /** Palavras que mandam um lançamento para esta categoria (ex.: "barbearia" → Beleza). Só nas categorias do usuário. */
  keywords: text("keywords").array().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("categories_user_key_uq").on(t.userId, t.key)]);

export const recurringItems = pgTable("recurring_items", {
  id: id(),
  userId: userId(),
  kind: recurringKindEnum("kind").notNull().default("BILL"),
  name: text("name").notNull(),
  amountCents: integer("amount_cents"),
  dayOfMonth: integer("day_of_month").notNull(),
  categoryKey: text("category_key"),
  active: boolean("active").notNull().default(true),
  /** Receitas/despesas fixas: até que dia já foram lançadas (evita lançar de novo o que o usuário apagou). */
  generatedUntil: date("generated_until", { mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("recurring_user_idx").on(t.userId, t.active)]);

export const expenses = pgTable("expenses", {
  id: id(),
  userId: userId(),
  amountCents: integer("amount_cents"),           // conta futura pode não ter valor
  description: text("description").notNull(),
  categoryKey: text("category_key").notNull().default("outros"),
  method: paymentMethodEnum("method"),
  date: date("date", { mode: "string" }).notNull(),
  status: expenseStatusEnum("status").notNull().default("PAID"),
  dueDate: date("due_date", { mode: "string" }),   // contas a pagar
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
  recurringItemId: text("recurring_item_id").references(() => recurringItems.id, { onDelete: "set null" }),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }), // compartilhado com a família
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("expenses_user_date_idx").on(t.userId, t.date),
  index("expenses_user_status_idx").on(t.userId, t.status, t.dueDate),
  uniqueIndex("expenses_recurring_due_uq").on(t.recurringItemId, t.dueDate),
]);

export const income = pgTable("income", {
  id: id(),
  userId: userId(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  categoryKey: text("category_key").notNull().default("outros"),
  date: date("date", { mode: "string" }).notNull(),
  recurringItemId: text("recurring_item_id").references(() => recurringItems.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("income_user_idx").on(t.userId, t.date),
  uniqueIndex("income_recurring_date_uq").on(t.recurringItemId, t.date),
]);

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(),
  cycle: billingCycleEnum("cycle").notNull().default("MONTHLY"),
  nextBilling: date("next_billing", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("subscriptions_user_idx").on(t.userId, t.active)]);

// ─────────────── Compras ───────────────
export const shoppingLists = pgTable("shopping_lists", {
  id: id(),
  userId: userId(),
  name: text("name").notNull().default("Compras"),
  isDefault: boolean("is_default").notNull().default(true),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }), // compartilhado com a família
  createdAt: createdAt(),
}, (t) => [index("shopping_lists_user_idx").on(t.userId)]);

export const shoppingItems = pgTable("shopping_items", {
  id: id(),
  listId: text("list_id").notNull().references(() => shoppingLists.id, { onDelete: "cascade" }),
  userId: userId(),
  name: text("name").notNull(),
  quantity: text("quantity"),
  checked: boolean("checked").notNull().default(false),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }), // compartilhado com a família
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("shopping_items_user_idx").on(t.userId, t.checked)]);

// ─────────────── Casa (interface na fase 2; tabelas prontas) ───────────────
export const documents = pgTable("documents", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  category: documentCategoryEnum("category").notNull().default("OUTRO"),
  date: date("date", { mode: "string" }).notNull(),
  expiresAt: date("expires_at", { mode: "string" }),
  notes: text("notes"),
  fileKey: text("file_key"),       // chave no storage (arquivo criptografado)
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("documents_user_idx").on(t.userId, t.expiresAt)]);

export const warranties = pgTable("warranties", {
  id: id(),
  userId: userId(),
  item: text("item").notNull(),
  purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
  months: integer("months").notNull(),
  expiresAt: date("expires_at", { mode: "string" }).notNull(),
  documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [index("warranties_user_idx").on(t.userId, t.expiresAt)]);

// ─────────────── Alertas, memória e uso ───────────────
export const notifications = pgTable("notifications", {
  id: id(),
  userId: userId(),
  kind: text("kind").notNull(),          // event_tomorrow, bill_due, shopping_stale, task_late…
  title: text("title").notNull(),
  body: text("body"),
  dedupeKey: text("dedupe_key").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
  index("notifications_user_idx").on(t.userId, t.scheduledFor),
]);

export const aiMemory = pgTable("ai_memory", {
  id: id(),
  userId: userId(),
  fact: text("fact").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("ai_memory_user_idx").on(t.userId)]);

export const usageCounters = pgTable("usage_counters", {
  id: id(),
  userId: userId(),
  month: text("month").notNull(), // "YYYY-MM"
  interactions: integer("interactions").notNull().default(0),
}, (t) => [uniqueIndex("usage_user_month_uq").on(t.userId, t.month)]);

// ─────────────── Fase 2: família ───────────────
export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shareFinance: boolean("share_finance").notNull().default(false),
  createdAt: createdAt(),
});

export const householdMembers = pgTable("household_members", {
  householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }), // 1 família por pessoa
  role: householdRoleEnum("role").notNull().default("MEMBER"),
  joinedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.householdId, t.userId] })]);

export const householdInvites = pgTable("household_invites", {
  id: id(),
  householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // só o hash; o link tem o token
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
}, (t) => [index("household_invites_hh_idx").on(t.householdId)]);

// ─────────────── Fase 2: notificações push ───────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: userId(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("push_user_idx").on(t.userId)]);

// ─────────────── Fase 2: pagamentos (Asaas) ───────────────
export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: id(),
  userId: userId(),
  provider: text("provider").notNull().default("asaas"),
  providerSubscriptionId: text("provider_subscription_id").notNull().unique(),
  plan: planEnum("plan").notNull(),
  status: billingStatusEnum("status").notNull().default("PENDING"),
  valueCents: integer("value_cents").notNull(),
  currentPeriodEnd: date("current_period_end", { mode: "string" }),
  overdueSince: date("overdue_since", { mode: "string" }),
  lastInvoiceUrl: text("last_invoice_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("billing_user_idx").on(t.userId, t.status)]);

export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),  // id do evento no provedor (idempotência)
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
});

// ─────────────── Fase 2: WhatsApp ───────────────
export const whatsappLinkCodes = pgTable("whatsapp_link_codes", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  attempts: integer("attempts").notNull().default(0),
});

export const whatsappInbound = pgTable("whatsapp_inbound", {
  wamid: text("wamid").primaryKey(), // id da mensagem na Meta (idempotência)
  receivedAt: createdAt(),
});

// ─────────────── Não deixe nada passar ───────────────
/** Vencimentos e renovações: seguro, CNH, IPVA, contrato, revisão… Avisa X dias antes. */
export const deadlines = pgTable("deadlines", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("outro"),          // seguro, documento, imposto, contrato, revisao, outro
  dueDate: date("due_date", { mode: "string" }).notNull(),
  remindDaysBefore: integer("remind_days_before").notNull().default(30),
  renewMonths: integer("renew_months"),                    // renova sozinho (ex.: seguro = 12)
  notes: text("notes"),
  done: boolean("done").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
}, (t) => [index("deadlines_user_idx").on(t.userId, t.done, t.dueDate)]);

/** Compras de rotina: "ração quando estiver acabando" → volta para a lista a cada N dias. */
export const shoppingRoutines = pgTable("shopping_routines", {
  id: id(),
  userId: userId(),
  householdId: text("household_id").references(() => households.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  everyDays: integer("every_days").notNull().default(30),
  nextDate: date("next_date", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("shopping_routines_user_idx").on(t.userId, t.active, t.nextDate)]);

// ─────────────── Cartões de crédito ───────────────
export const creditCards = pgTable("credit_cards", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  closingDay: integer("closing_day").notNull(),   // dia em que a fatura fecha
  dueDay: integer("due_day").notNull(),           // dia de vencimento
  limitCents: integer("limit_cents"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("credit_cards_user_idx").on(t.userId, t.active)]);

export const cardPurchases = pgTable("card_purchases", {
  id: id(),
  userId: userId(),
  cardId: text("card_id").notNull().references(() => creditCards.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  totalCents: integer("total_cents").notNull(),
  installments: integer("installments").notNull().default(1),
  purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
  categoryKey: text("category_key").notNull().default("outros"),
  cancelled: boolean("cancelled").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("card_purchases_user_idx").on(t.userId, t.cardId)]);

/** Uma linha por parcela, já na fatura (vencimento) em que ela cai. */
export const cardInstallments = pgTable("card_installments", {
  id: id(),
  userId: userId(),
  cardId: text("card_id").notNull().references(() => creditCards.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id").notNull().references(() => cardPurchases.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  amountCents: integer("amount_cents").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
}, (t) => [
  index("card_inst_user_due_idx").on(t.userId, t.dueDate),
  index("card_inst_card_due_idx").on(t.cardId, t.dueDate),
  uniqueIndex("card_inst_purchase_number_uq").on(t.purchaseId, t.number),
]);

/** Faturas pagas (a fatura em si é a soma das parcelas daquele vencimento). */
export const cardInvoicePayments = pgTable("card_invoice_payments", {
  id: id(),
  userId: userId(),
  cardId: text("card_id").notNull().references(() => creditCards.id, { onDelete: "cascade" }),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("card_invoice_paid_uq").on(t.cardId, t.dueDate)]);

export type User = typeof users.$inferSelect;
export type CreditCard = typeof creditCards.$inferSelect;
export type Deadline = typeof deadlines.$inferSelect;
export type ShoppingRoutine = typeof shoppingRoutines.$inferSelect;
export type CardPurchase = typeof cardPurchases.$inferSelect;
export type CardInstallment = typeof cardInstallments.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Income = typeof income.$inferSelect;
export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof aiMemory.$inferSelect;
export type Household = typeof households.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Warranty = typeof warranties.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
