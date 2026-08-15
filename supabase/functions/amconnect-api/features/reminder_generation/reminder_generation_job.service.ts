import { SupabaseClient } from "@supabase/supabase-js";
import { calcTimezoneOffset, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { ReminderGenerationRepository } from "../../modules/reminder/reminder_generation.repository.ts";
import { ReminderGenerationService } from "../../modules/reminder/reminder_generation.service.ts";
import { ReminderSettingRepository } from "../../modules/reminder/reminder_setting.repository.ts";
import {
  ReminderSettingResolver,
  ReminderSettingService,
} from "../../modules/reminder/reminder_setting.service.ts";
import type {
  IReminderGenerationJobRepository,
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
}

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
  ) {}

  async run(): Promise<ReminderGenerationJobResult> {
    const generationRepository = new ReminderGenerationRepository(this.supabase);
    const settingRepository = new ReminderSettingRepository(this.supabase);
    // One resolver per agent, reused across all of that agent's rows.
    const resolvers = new Map<string, ReminderSettingResolver>();

    // The advisor's timezone, saved from the x-timezone header on their last
    // request. Without it a reminder could land on the wrong local day.
    const timezones = await this.jobRepository.findAgentTimezones();
    const offsets = new Map<string, string>();
    const offsetFor = (agentId: string): string => {
      const cached = offsets.get(agentId);
      if (cached) return cached;
      const offset = calcTimezoneOffset(timezones.get(agentId) ?? DEFAULT_TIMEZONE);
      offsets.set(agentId, offset);
      return offset;
    };

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

    for await (const policies of this.pages<JobPolicyRow>((o, l) => this.jobRepository.findActivePolicies(o, l))) {
      for (const policy of policies) {
        policiesScanned++;
        if (policy.statusCode && SILENCED_POLICY_STATUS_CODES.has(policy.statusCode)) continue;
        try {
          const result = await generationService.generateForPolicy(
            policy,
            policy.agentId,
            offsetFor(policy.agentId),
            await resolverFor(policy.agentId),
          );
          remindersCreated += result.created.length;
        } catch (error) {
          // One bad policy must not stop the nightly pass for everyone else.
          console.error(
            `[ReminderGenerationJob] policy ${policy.id}:`,
            error instanceof Error ? error.message : String(error),
          );
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
            offsetFor(contact.agentId),
            await resolverFor(contact.agentId),
          );
          remindersCreated += result.created.length;
        } catch (error) {
          console.error(
            `[ReminderGenerationJob] contact ${contact.id}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    console.warn(
      `[ReminderGenerationJob] ${policiesScanned} pólizas, ${contactsScanned} contactos, ${remindersCreated} recordatorios creados`,
    );

    return { policiesScanned, contactsScanned, remindersCreated };
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
