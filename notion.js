// notion.js - Task & Note Storage via Notion API
// Install: npm install @notionhq/client

const { Client } = require('@notionhq/client');

class NotionTaskManager {
  constructor(config) {
    this.notion = new Client({ auth: config.apiKey });
    this.databaseId = config.databaseId; // Your Notion database ID
    this.notesPageId = config.notesPageId; // Optional: running notes page
  }

  /**
   * Add task to Notion database
   * @param {Object} actionData - { action, deadline, priority, motivation, userId }
   * @returns {Promise<string>} Page ID
   */
  async addTask(actionData) {
    try {
      const response = await this.notion.pages.create({
        parent: {
          database_id: this.databaseId
        },
        properties: {
          // These property names should match your Notion database schema
          'Task': {
            title: [
              {
                text: {
                  content: actionData.action
                }
              }
            ]
          },
          'Deadline': {
            date: {
              start: this._parseDeadlineToISO(actionData.deadline),
              time_zone: 'UTC'
            }
          },
          'Priority': {
            select: {
              name: this._capitalizePriority(actionData.priority)
            }
          },
          'Status': {
            select: {
              name: 'To Do'
            }
          },
          'User ID': {
            rich_text: [
              {
                text: {
                  content: actionData.userId || 'unknown'
                }
              }
            ]
          },
          'Motivation': {
            rich_text: [
              {
                text: {
                  content: actionData.motivation
                }
              }
            ]
          }
        }
      });

      console.log('✅ Added to Notion:', actionData.action);
      return response.id;
    } catch (error) {
      console.error('❌ Notion error:', error.message);
      throw error;
    }
  }

  /**
   * Get all tasks for a user
   */
  async getUserTasks(userId, status = 'To Do') {
    try {
      const response = await this.notion.databases.query({
        database_id: this.databaseId,
        filter: {
          and: [
            {
              property: 'User ID',
              rich_text: {
                contains: userId
              }
            },
            {
              property: 'Status',
              select: {
                equals: status
              }
            }
          ]
        },
        sorts: [
          {
            property: 'Deadline',
            direction: 'ascending'
          }
        ]
      });

      return response.results.map(page => ({
        id: page.id,
        task: this._extractText(page.properties.Task),
        deadline: page.properties.Deadline?.date?.start,
        priority: page.properties.Priority?.select?.name,
        status: page.properties.Status?.select?.name
      }));
    } catch (error) {
      console.error('❌ Failed to fetch tasks:', error.message);
      return [];
    }
  }

  /**
   * Mark task as complete
   */
  async completeTask(pageId) {
    try {
      await this.notion.pages.update({
        page_id: pageId,
        properties: {
          'Status': {
            select: {
              name: 'Done'
            }
          }
        }
      });

      console.log('✅ Marked as complete:', pageId);
    } catch (error) {
      console.error('❌ Error updating task:', error.message);
    }
  }

  /**
   * Append to running notes page
   * @param {Object} note - { title, content, userId }
   */
  async addNote(note) {
    try {
      // If notesPageId provided, append to that page
      if (this.notesPageId) {
        await this.notion.blocks.children.append({
          block_id: this.notesPageId,
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: `[${new Date().toLocaleString()}] ${note.title}: ${note.content}`
                    }
                  }
                ]
              }
            }
          ]
        });

        console.log('✅ Added note to Notion');
      }
    } catch (error) {
      console.error('❌ Error adding note:', error.message);
    }
  }

  /**
   * Get today's summary
   */
  async getTodaySummary(userId) {
    try {
      const today = new Date().toISOString().split('T')[0];

      const response = await this.notion.databases.query({
        database_id: this.databaseId,
        filter: {
          and: [
            {
              property: 'User ID',
              rich_text: {
                contains: userId
              }
            },
            {
              property: 'Deadline',
              date: {
                on_or_before: today
              }
            },
            {
              property: 'Status',
              select: {
                does_not_equal: 'Done'
              }
            }
          ]
        }
      });

      const tasks = response.results.map(page => ({
        task: this._extractText(page.properties.Task),
        priority: page.properties.Priority?.select?.name
      }));

      return tasks;
    } catch (error) {
      console.error('❌ Error fetching summary:', error.message);
      return [];
    }
  }

  /**
   * Parse deadline string to ISO date (YYYY-MM-DD)
   */
  _parseDeadlineToISO(deadlineStr) {
    const now = new Date();
    const str = deadlineStr.toLowerCase().trim();

    if (str === 'today') {
      return now.toISOString().split('T')[0];
    }

    if (str === 'tomorrow') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }

    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }

    // "in X days"
    const daysMatch = str.match(/in (\d+) days?/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]);
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      return future.toISOString().split('T')[0];
    }

    // Default to today
    return now.toISOString().split('T')[0];
  }

  /**
   * Capitalize priority level
   */
  _capitalizePriority(priority) {
    const map = {
      high: 'High',
      medium: 'Medium',
      low: 'Low'
    };
    return map[priority?.toLowerCase()] || 'Medium';
  }

  /**
   * Extract text from Notion rich text block
   */
  _extractText(property) {
    if (!property || !property.title) return '';
    return property.title.map(block => block.plain_text).join('');
  }

  /**
   * Setup: Create a new Notion database with task properties
   * Call this once to initialize your Notion workspace
   */
  async setupDatabase(parentPageId) {
    try {
      const database = await this.notion.databases.create({
        parent: {
          page_id: parentPageId
        },
        title: [
          {
            text: {
              content: 'Assistant Tasks'
            }
          }
        ],
        properties: {
          'Task': {
            title: {}
          },
          'Deadline': {
            date: {}
          },
          'Priority': {
            select: {
              options: [
                { name: 'High', color: 'red' },
                { name: 'Medium', color: 'yellow' },
                { name: 'Low', color: 'green' }
              ]
            }
          },
          'Status': {
            select: {
              options: [
                { name: 'To Do', color: 'blue' },
                { name: 'In Progress', color: 'purple' },
                { name: 'Done', color: 'green' }
              ]
            }
          },
          'User ID': {
            rich_text: {}
          },
          'Motivation': {
            rich_text: {}
          }
        }
      });

      console.log('✅ Database created:', database.id);
      return database.id;
    } catch (error) {
      console.error('❌ Error creating database:', error.message);
    }
  }
}

module.exports = NotionTaskManager;

// Usage example:
/*
const NotionTaskManager = require('./notion');

const notion = new NotionTaskManager({
  apiKey: 'secret_xxxxx', // From Notion integration settings
  databaseId: 'abc123def456...' // Your database ID from URL
});

const actionData = {
  action: 'Fix login bug',
  deadline: 'tomorrow',
  priority: 'high',
  motivation: 'You got this!',
  userId: 'slack:U123456'
};

notion.addTask(actionData).then(pageId => {
  console.log('Task added:', pageId);
}).catch(err => {
  console.error('Error:', err.message);
});

// Get user's tasks
notion.getUserTasks('slack:U123456').then(tasks => {
  console.log('User tasks:', tasks);
});

// Add a note
notion.addNote({
  title: 'Daily Note',
  content: 'Fixed the login bug, still need to test on mobile',
  userId: 'slack:U123456'
});
*/
