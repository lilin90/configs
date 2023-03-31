import { Octokit } from "https://cdn.skypack.dev/octokit?dts";
import { join } from "https://deno.land/std/path/mod.ts";

interface CodeownersEntry {
  pattern: string;
  owners: string[];
}

interface ProwOwners {
  reviewers: string[];
  approvers: string[];
  labels?: string[];
}

async function getTeamMember(
  organization: string,
  teamSlug: string,
  token: string,
) {
  // Create an instance of the Octokit client
  const octokit = new Octokit({
    auth: token,
  });

  // Get the list of team members

  const { data: members } = await octokit.rest.teams.listMembersInOrg({
    org: organization,
    team_slug: teamSlug,
  });

  return (members as { login: string }[]).map(({ login }) => login);
}

async function parseCodeowners(path: string, token: string) {
  const content = Deno.readTextFileSync(path);

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  const entries = await Promise.all(lines.map(async (line) => {
    const [pattern, owners] = line.split(/\s+/);
    const logins = await Promise.all(
      owners.split(/\s+/).map(async (owner) => {
        if (owner.startsWith("@")) {
          const [org, teamSlug] = owner.slice(1).split("/", 2);
          return await getTeamMember(org, teamSlug, token);
        } else {
          return owner;
        }
      }),
    ).then((results) => results.flat());

    return { pattern, owners: logins };
  }));

  return entries;
}

function generateProwOwnersFiles(
  codeownersEntries: CodeownersEntry[],
  basePath: string,
): void {
  const extensionRegex = /\.\w+$/;

  const directories = codeownersEntries
    .filter((entry) =>
      !extensionRegex.test(entry.pattern) || entry.owners.length === 0
    )
    .map(({ pattern }) => pattern);

  directories.forEach((dir) => {
    const approverLines = codeownersEntries
      .filter((entry) =>
        entry.pattern.startsWith(`${dir}/`) || entry.pattern === dir
      )
      .flatMap((entry) => entry.owners)
      .filter((owner, index, array) => array.indexOf(owner) === index) // remove duplicates
      .map((owner) => `  - ${owner}`)
      .join("\n");

    const ownersFilePath = join(basePath, dir, "OWNERS");
    const ownersContent =
      `reviewers:\n${approverLines}\napprovers:\n${approverLines}\n`;
    Deno.writeTextFileSync(ownersFilePath, ownersContent);
  });
}

async function main(pathOfCodeOwners: string, token: string) {
  const owners = await parseCodeowners(pathOfCodeOwners, token);
  await generateProwOwnersFiles(owners, "./");
}

const token = Deno.env.get("GITHUB_TOKEN");
await main(Deno.args[0], token || "");
Deno.exit(0);
