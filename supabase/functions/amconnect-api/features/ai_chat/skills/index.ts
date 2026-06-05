import { SkillDefinition } from "./skill.core.ts";
import { contactSkills } from "./contact.skills.ts";
import { policySkills } from "./policy.skills.ts";
import { reminderSkills } from "./reminder.skills.ts";
import { pendingTaskSkills } from "./pending_task.skills.ts";
import { catalogSkills } from "./catalog.skills.ts";
import { policyIngestionSkills } from "./policy_ingestion.skills.ts";
import { knowledgeSkills } from "./knowledge.skills.ts";

export const skillRegistry: SkillDefinition[] = [
  ...contactSkills,
  ...policySkills,
  ...reminderSkills,
  ...pendingTaskSkills,
  ...catalogSkills,
  ...policyIngestionSkills,
  ...knowledgeSkills,
];

export function getSkillByName(name: string): SkillDefinition | undefined {
  return skillRegistry.find((s) => s.declaration.name === name);
}

export function getSkillsByDomains(domains: string[]): SkillDefinition[] {
  return skillRegistry.filter((s) => domains.includes(s.domain));
}
