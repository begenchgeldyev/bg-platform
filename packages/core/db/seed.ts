import { eq } from 'drizzle-orm';
import { db } from './db';
import { policies, projects, users } from './schema';

await db
  .insert(users)
  .values({
    email: 'begenchgeldyev@gmail.com',
    role: 'owner',
    attributes: {},
  })
  .onConflictDoNothing();

await db
  .insert(policies)
  .values([
    {
      name: 'owner-full-access',
      effect: 'allow',
      subjectCondition: { role: 'owner' },
      action: '*',
      resource: '*',
    },
  ])
  .onConflictDoNothing();

const seedProjects = [
  {
    name: 'Interpreter',
    description:
      'A C++ interpreter for a custom programming language based on context-free grammar, LL(1) parsing, Reverse Polish Notation generation, and RPN execution.',
    content: `Interpreter is a C++ project that implements the core stages of a programming language interpreter for a custom language defined by context-free grammar. 
  The project is structured around three main components. First, lexical analysis scans the input source and converts it into tokens. Second, syntactic analysis validates the token sequence using the LL(1) parsing technique. During parsing, the interpreter also generates Reverse Polish Notation, which acts as an intermediate representation of the program. Finally, the RPN executor evaluates the generated instructions and handles computation and control flow according to the language semantics.
  The repository also includes a theory directory with formal grammar materials, including BNF definitions, transition tables, rule-generation tables, and RPN-generation tables. A tests directory demonstrates the capabilities of the custom language.
  This project helped me better understand how programming languages work internally, including tokenization, parsing, intermediate representation generation, and execution.`,
    tags: [],
  },
  {
    name: 'This Website',
    description: 'Personal portfolio & blog. Built with HTMX, Tailwind CSS, and a Bun server.',
    content: null,
    tags: ['HTMX', 'Tailwind CSS', 'Bun'],
  },
  {
    name: 'Telegram Bot',
    description: 'Bot for connecting advertisers and influencers. Built with python-telegram-bot, MongoDB, and deployed on Yandex Cloud.',
    image: '/public/projects/telegram-bot.jpg',
    content:
      '<p>Open the bot in Telegram: <a href="https://t.me/adhavenBot" target="_blank" rel="noopener noreferrer">t.me/adhavenBot</a></p>',
    tags: ['Python', 'MongoDB', 'Telegram API'],
  },
];

for (const project of seedProjects) {
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, project.name)).limit(1);

  if (existing) {
    console.log(`Skipped project (already exists): ${project.name}`);
    continue;
  }

  await db.insert(projects).values(project);
  console.log(`Inserted project: ${project.name}`);
}

console.log('Seeded successfully');
process.exit(0);
