import { SupabaseClient } from "@supabase/supabase-js";
import { calcTimezoneOffset, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { ReminderGenerationRepository } from "../../modules/reminder/reminder_generation.repository.ts";
import { ReminderGenerationService } from "../../modules/reminder/reminder_generation.service.ts";
import { ReminderSettingRepository } from "../../modules/reminder/reminder_setting.repository.ts";
import {
  ReminderSettingResolver,
  ReminderSettingService,
} from "../../modules/reminder/reminder_setting.service.ts";
import type { ICronErrorLogger } from "../notification/notification.service.ts";
import type {
  IReminderGenerationJobRepository,
  JobAgentInfo,
  JobContactRow,
  JobPolicyRow,
} from "./reminder_generation_job.repository.ts";

const PAGE_SIZE = 500;

/**
 * Policy statuses that stop the reminders. The status is set by hand and nothing
 * keeps it in sync with the dates, so an untouched status is never taken as a
 * reason to go quiet — but when the advisor did mark the policy dead, respect it.
 */
const SILENCED_POLICY_STATUS_CODES = new Set(["CANCELLED", "EXPIRED"]);

export interface ReminderGenerationJobResult {
  policiesScanned: number;
  contactsScanned: number;
  remindersCreated: number;
  /** Pólizas o contactos cuya generación falló (se reintentan la noche siguiente). */
  failed: number;
}

/** Cuántas fallas se guardan como muestra en error_logs. */
const MAX_FAILURE_SAMPLES = 20;

/**
 * The daily pass that keeps reminders coming. Nothing is scheduled ahead of time:
 * every night this walks the book, recomputes each policy's next occurrence from
 * its own rule, and writes a reminder only for the ones that just entered the
 * advisor's warning window.
 *
 * Runs with the service-role client (skips RLS) because it serves every agent —
 * the same documented exception as the notification cron.
 */
export class ReminderGenerationJobService {
  constructor(
    private readonly jobRepository: IReminderGenerationJobRepository,
    private readonly supabase: SupabaseClient,
    private readonly errorLogger?: ICronErrorLogger,
  ) {}

  async run(): Promise<ReminderGenerationJobResult> {
    const generationRepository = new ReminderGenerationRepository(this.supabase);
    const settingRepository = new ReminderSettingRepository(this.supabase);
    // One resolver per agent, reused across all of that agent's rows.
    const resolvers = new Map<string, ReminderSettingResolver>();

    // Zona horaria e idioma del asesor vienen embebidos en cada fila (se
    // guardan de x-timezone y Accept-Language en su última petición). Sin la
    // zona un recordatorio podía caer en otro día local; sin el idioma los
    // títulos salían en español para todos.
    const offsets = new Map<string, string>();
    const offsetFor = (agent: JobAgentInfo): string => {
      const timezone = agent.timezone ?? DEFAULT_TIMEZONE;
      const cached = offsets.get(timezone);
      if (cached) return cached;
      const offset = calcTimezoneOffset(timezone);
      offsets.set(timezone, offset);
      return offset;
    };
    const localeFor = (agent: JobAgentInfo): string => agent.locale ?? "es";

    const resolverFor = async (agentId: string): Promise<ReminderSettingResolver> => {
      const cached = resolvers.get(agentId);
      if (cached) return cached;
      const resolver = await new ReminderSettingService(settingRepository, agentId).buildResolver();
      resolvers.set(agentId, resolver);
      return resolver;
    };

    // The setting service is only used for the resolver, which is always passed
    // in explicitly below, so the agent it is bound to here never matters.
    const generationService = new ReminderGenerationService(
      generationRepository,
      new ReminderSettingService(settingRepository, ""),
    );

    let policiesScanned = 0;
    let contactsScanned = 0;
    let remindersCreated = 0;
    const failures: Array<{ kind: "policy" | "contact"; id: string; error: string }> = [];
    const recordFailure = (kind: "policy" | "contact", id: string, error: unknown) => {
      const message = error instanceof Error
        ? ((error as { internal?: string }).internal ?? error.message)
        : String(error);
      console.error(`[ReminderGenerationJob] ${kind} ${id}:`, message);
      failures.push({ kind, id, error: message });
    };

    for await (const policies of this.pages<JobPolicyRow>((o, l) => this.jobRepository.findActivePolicies(o, l))) {
      for (const policy of policies) {
        policiesScanned++;
        if (policy.statusCode && SILENCED_POLICY_STATUS_CODES.has(policy.statusCode)) continue;
        try {
          const result = await generationService.generateForPolicy(
            policy,
            policy.agentId,
            offsetFor(policy),
            await resolverFor(policy.agentId),
            localeFor(policy),
          );
          remindersCreated += result.created.length;
          if (result.error) failures.push({ kind: "policy", id: policy.id, error: result.error });
        } catch (error) {
          // One bad policy must not stop the nightly pass for everyone else.
          recordFailure("policy", policy.id, error);
        }
      }
    }

    for await (
      const contacts of this.pages<JobContactRow>((o, l) => this.jobRepository.findContactsWithBirthdate(o, l))
    ) {
      for (const contact of contacts) {
        contactsScanned++;
        try {
          const result = await generationService.generateForContact(
            contact,
            contact.agentId,
            offsetFor(contact),
            await resolverFor(contact.agentId),
            localeFor(contact),
          );
          remindersCreated += result.created.length;
          if (result.error) failures.push({ kind: "contact", id: contact.id, error: result.error });
        } catch (error) {
          recordFailure("contact", contact.id, error);
        }
      }
    }

    console.warn(
      `[ReminderGenerationJob] ${policiesScanned} pólizas, ${contactsScanned} contactos, ${remindersCreated} recordatorios creados, ${failures.length} fallas`,
    );

    const result = { policiesScanned, contactsScanned, remindersCreated, failed: failures.length };
    // Las fallas por fila no tumban la corrida, así que el error middleware nunca
    // las ve: se deja un registro resumido en error_logs (solo ids, sin datos
    // de clientes).
    if (failures.length > 0 && this.errorLogger) {
      await this.errorLogger.log({
        errorType: "ReminderGenerationJobFailure",
        statusCode: 500,
        errorMessage: `reminder generation job: ${failures.length} rows failed`,
        requestPath: "/amconnect-api/reminders/generate-due",
        requestMethod: "POST",
        metadata: { severity: "server", result, failures: failures.slice(0, MAX_FAILURE_SAMPLES) },
      });
    }
    return result;
  }

  private async *pages<T>(fetch: (offset: number, limit: number) => Promise<T[]>): AsyncGenerator<T[]> {
    let offset = 0;
    while (true) {
      const rows = await fetch(offset, PAGE_SIZE);
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < PAGE_SIZE) return;
      offset += PAGE_SIZE;
    }
  }
}
