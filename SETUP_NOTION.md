# Notion Integration Setup

## What you get
- All tasks stored in Notion database
- See status: "To Do" → "In Progress" → "Done"
- Filter by priority, deadline, user
- Running notes page for daily thoughts
- Access from anywhere (Notion app, web, mobile)

## Prerequisites
- Free Notion account at https://notion.so

## Step-by-step Setup

### 1. Create Notion Integration
1. Go to https://www.notion.so/my-integrations
2. Click "Create new integration"
3. Name: "Personal Assistant Bot"
4. Click "Submit"
5. Copy the "Internal Integration Token" (looks like: `secret_ABC123...`)
6. Paste in `.env`: `NOTION_API_KEY=secret_ABC123...`

### 2. Create a Notion Database
**Option A: Automatic (Easiest)**
```bash
node -e "
const NotionTaskManager = require('./notion');

const notion = new NotionTaskManager({
  apiKey: 'secret_ABC123...'
});

// Your Notion page ID (see Step 2b below)
notion.setupDatabase('abc123def456...');
"
```

**Option B: Manual**
1. Open https://notion.so
2. Create a new page (or use existing)
3. Add a database with these columns:
   - Task (Title)
   - Deadline (Date)
   - Priority (Select: High, Medium, Low)
   - Status (Select: To Do, In Progress, Done)
   - User ID (Text)
   - Motivation (Text)

### 2b. Get Your Database ID
1. Open your Notion database
2. Look at the URL: `https://notion.so/abc123def456?v=xyz`
3. The long string `abc123def456` is your Database ID
4. Paste in `.env`: `NOTION_DATABASE_ID=abc123def456`

### 3. Connect Integration to Database
1. Open your Notion database
2. Click "Share" (top right)
3. Click "Invite"
4. Search for "Personal Assistant Bot" (the integration you created)
5. Select it and click "Invite"
6. Confirm

### 4. Update .env
```env
NOTION_API_KEY=secret_ABC123...
NOTION_DATABASE_ID=abc123def456...
# Optional: running notes page ID
NOTION_NOTES_PAGE_ID=abc123def456...
```

### 5. Test
```bash
npm start
```

Send a task to Slack/Telegram. Check your Notion database - task should appear!

## Troubleshooting

**"Cannot find module '@notionhq/client'"**
```bash
npm install @notionhq/client
```

**"Invalid database_id"**
- Make sure your Database ID is correct (copy-paste from URL)
- Database ID is the long string, not the short code

**"Integration does not have access to this database"**
- Go to your Notion database
- Click "Share" → Make sure "Personal Assistant Bot" is invited
- Wait a few seconds for sync

**"Property 'Task' does not exist"**
- Your database columns don't match the code
- Either:
  - Create the columns: Task, Deadline, Priority, Status, User ID, Motivation
  - Or edit `notion.js` to match your column names

**Notion connection timing out**
- Check your internet connection
- Notion API might be slow (rare, but happens)
- Try again in a few seconds

## Optional: Notes Page

For a running notes feature (append daily thoughts):
1. Create a new Notion page
2. Click the "..." menu → Copy link
3. Extract the page ID from the URL
4. Add to `.env`: `NOTION_NOTES_PAGE_ID=abc123def456...`

## Using Notion Database Features

**Filter by User**
Once tasks are in Notion, you can:
- Filter: `User ID contains slack:U123456`
- Sort by Deadline ascending
- Group by Priority
- Search by task name

**Mark Tasks Complete**
In the bot, use emoji reactions or click checkbox. Or in Notion:
1. Open task
2. Change Status to "Done"
3. The bot respects this

**View in Notion Mobile**
- Open Notion app on your phone
- Go to your database
- See all tasks, update status on the go

## Database Properties Reference

| Property | Type | Purpose |
|----------|------|---------|
| Task | Title | The action item |
| Deadline | Date | When it's due |
| Priority | Select | High/Medium/Low |
| Status | Select | To Do/In Progress/Done |
| User ID | Text | Who created it (Slack/Telegram ID) |
| Motivation | Text | Encouragement message |

## Advanced: Filter by User

In your Slack/Telegram, users have IDs:
- Slack: `slack:U123456` (in the code: `req.body.event.user`)
- Telegram: `telegram:123456` (in the code: `update.message.from.id`)

The bot automatically tags tasks with user IDs, so you can:
```bash
# In Notion filters
User ID contains "slack:U123456"
```

This way each person's tasks stay organized.

## Multiple Databases

Want to separate personal vs work tasks?
```env
# Personal DB
NOTION_DATABASE_ID=abc123...

# Work DB (create separate instance/env)
NOTION_DATABASE_ID=def456...
```

Or use Notion's built-in filters/views.

## Tips

1. **Weekly Review**: Every Sunday, go to Notion, filter Status != "Done", plan next week
2. **Habit Tracking**: Add a "Habit" column to track recurring tasks
3. **Analytics**: Create a Notion formula that counts "Done" tasks per week
4. **Templates**: Use Notion database templates for common task types
5. **Relations**: Link related tasks together (if a bug fix depends on another task)

Notion is powerful - you can build a full personal OS around this!
