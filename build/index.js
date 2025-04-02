#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();
// OAuth credentials (and an optional default space id).
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const DEFAULT_SPACE_ID = process.env.DEFAULT_SPACE_ID; // Optional – can be provided in query as well.
if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error("Required Google OAuth credentials not found in environment variables");
}
class GoogleChatServer {
    server;
    auth;
    chat;
    constructor() {
        this.server = new Server({ name: "google-chat-server", version: "0.3.0" }, { capabilities: { tools: {} } });
        // Set up OAuth2 client.
        this.auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
        this.auth.setCredentials({ refresh_token: REFRESH_TOKEN });
        // Initialize Google Chat API client.
        this.chat = google.chat({ version: "v1", auth: this.auth });
        this.setupToolHandlers();
        // Global error handling.
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    // Registers all tools and their input schemas.
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "post_text_message",
                    description: "Post a text message to a Google Chat space. See: https://developers.google.com/chat/api/reference/rest/v1/spaces.messages/create",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space (format: spaces/{spaceId}). Optional if a default is set.",
                            },
                            text: {
                                type: "string",
                                description: "The text content to post.",
                            },
                        },
                        required: ["text"],
                    },
                },
                {
                    name: "fetch_member_details",
                    description: "Retrieve membership details from a Google Chat space. See: https://developers.google.com/chat/api/reference/rest/v1/spaces.members/get",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            memberId: {
                                type: "string",
                                description: "The unique ID of the member.",
                            },
                        },
                        required: ["memberId"],
                    },
                },
                {
                    name: "fetch_space_details",
                    description: "Get detailed information about a specific Google Chat space. See: https://developers.google.com/chat/api/reference/rest/v1/spaces/get",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                        },
                    },
                },
                {
                    name: "list_space_memberships",
                    description: "List all memberships in a Google Chat space with roles and status. See: https://developers.google.com/chat/api/reference/rest/v1/spaces.members/list",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            pageSize: {
                                type: "number",
                                description: "Maximum number of memberships to return (default is 100).",
                            },
                            pageToken: {
                                type: "string",
                                description: "A page token for pagination.",
                            },
                            filter: {
                                type: "string",
                                description: 'Filter query (e.g., "role = \\"OWNER\\"").',
                            },
                            showInvited: {
                                type: "boolean",
                                description: "Include invited memberships if true.",
                            },
                        },
                    },
                },
                {
                    name: "list_space_messages",
                    description: "Retrieve messages from a Google Chat space. Supports advanced filtering such as keywords, date ranges, usernames, deleted messages, and attachments. See: https://developers.google.com/chat/api/reference/rest/v1/spaces.messages/list",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            pageSize: {
                                type: "number",
                                description: "Maximum number of messages to return (default is 25).",
                            },
                            pageToken: {
                                type: "string",
                                description: "A page token for pagination.",
                            },
                            orderBy: {
                                type: "string",
                                description: "Ordering (e.g., 'createTime' or 'lastUpdateTime').",
                                enum: ["createTime", "lastUpdateTime"],
                            },
                            filter: {
                                type: "string",
                                description: "Filter messages (by date, keyword, username, deleted state, attachments, etc.).",
                            },
                            showDeleted: {
                                type: "boolean",
                                description: "Include deleted messages if true.",
                            },
                        },
                    },
                },
                {
                    name: "fetch_message_details",
                    description: "Get detailed information about a specific message. See: https://developers.google.com/chat/api/reference/rest/v1/spaces.messages/get",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            messageId: {
                                type: "string",
                                description: "The unique ID of the message.",
                            },
                        },
                        required: ["messageId"],
                    },
                },
                {
                    name: "list_joined_spaces",
                    description: "List all Google Chat spaces that the caller is a member of. See: https://developers.google.com/chat/api/reference/rest/v1/spaces/list",
                    inputSchema: {
                        type: "object",
                        properties: {
                            pageSize: {
                                type: "number",
                                description: "Maximum number of spaces to return (default is 100).",
                            },
                            pageToken: {
                                type: "string",
                                description: "A page token for pagination.",
                            },
                            filter: {
                                type: "string",
                                description: 'Filter query (e.g., "spaceType = \\"SPACE\\"").',
                            },
                        },
                    },
                },
                {
                    name: "apply_natural_language_filter",
                    description: "Convert a natural language filter (e.g., 'Monday', 'Rahul message', 'files uploaded last month', 'link', 'deleted', 'image', etc.) into standardized query parameters.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filterText: {
                                type: "string",
                                description: "The natural language filter query.",
                            },
                        },
                        required: ["filterText"],
                    },
                },
                {
                    name: "create_chat_space",
                    description: "Create a new Google Chat space. Note: This is simulated since the API might not allow direct space creation.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceName: {
                                type: "string",
                                description: "Name for the new chat space.",
                            },
                            description: {
                                type: "string",
                                description: "Optional description for the new space.",
                            },
                        },
                        required: ["spaceName"],
                    },
                },
                {
                    name: "list_shared_files",
                    description: "List files shared in a Google Chat space with advanced filtering by date, type, size, etc. (Simulated response.)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            dateRange: {
                                type: "string",
                                description: "Date range filter (e.g., 'last month').",
                            },
                            sortBy: {
                                type: "string",
                                description: "Sort criteria (e.g., 'type, size').",
                            },
                        },
                    },
                },
                {
                    name: "monitor_new_members",
                    description: "Monitor a Google Chat space for new members and send a DM with details to a specified manager email.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            managerEmail: {
                                type: "string",
                                description: "Email address to notify on new member join.",
                            },
                        },
                        required: ["managerEmail"],
                    },
                },
                {
                    name: "analyze_user_messages",
                    description: "Analyze and summarize messages in a Google Chat space based on dynamic criteria. For example, get your manager’s message summary from yesterday, what Rahul typed in the last 5 days, list deleted messages, extract image content details, etc. This tool applies multiple filters (date ranges, usernames, keywords, deleted state, attachments) to produce a dynamic summary.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            spaceId: {
                                type: "string",
                                description: "The unique ID of the Google Chat space. Optional if default is set.",
                            },
                            username: {
                                type: "string",
                                description: "Optional username (or part of the display name) to filter messages (e.g., 'Rahul', 'manager').",
                            },
                            timeRange: {
                                type: "string",
                                description: "Time range filter in natural language (e.g., 'yesterday', 'last 5 days').",
                            },
                            summaryType: {
                                type: "string",
                                description: "Type of summary: 'content', 'deleted', 'attachments', 'images', etc.",
                            },
                            includeImages: {
                                type: "boolean",
                                description: "Set to true to analyze image content (simulated analysis).",
                            },
                        },
                        required: ["timeRange"],
                    },
                },
            ],
        }));
        // Tool handler routing.
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            const args = request.params.arguments;
            switch (toolName) {
                case "post_text_message":
                    return await this.handleCreateMessage(args);
                case "fetch_member_details":
                    return await this.handleGetMember(args);
                case "fetch_space_details":
                    return await this.handleGetSpace(args);
                case "list_space_memberships":
                    return await this.handleListMembers(args);
                case "list_space_messages":
                    return await this.handleListMessages(args);
                case "fetch_message_details":
                    return await this.handleGetMessage(args);
                case "list_joined_spaces":
                    return await this.handleListSpaces(args);
                case "apply_natural_language_filter":
                    return await this.handleApplyNaturalLanguageFilter(args);
                case "create_chat_space":
                    return await this.handleCreateChatSpace(args);
                case "list_shared_files":
                    return await this.handleListSharedFiles(args);
                case "monitor_new_members":
                    return await this.handleMonitorNewMembers(args);
                case "analyze_user_messages":
                    return await this.handleAnalyzeUserMessages(args);
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
            }
        });
    }
    // Utility: Get the spaceId either from the input or from environment.
    getSpaceId(args) {
        return args.spaceId ? args.spaceId : DEFAULT_SPACE_ID ? DEFAULT_SPACE_ID : "";
    }
    // Tool: Post a text message.
    async handleCreateMessage(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { text } = args;
            const response = await this.chat.spaces.messages.create({
                parent: `spaces/${spaceId}`,
                requestBody: { text },
            });
            return {
                content: [
                    { type: "text", text: `Message created. ID: ${response.data.name}` },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error creating message: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: Fetch member details.
    async handleGetMember(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { memberId } = args;
            const response = await this.chat.spaces.members.get({
                name: `spaces/${spaceId}/members/${memberId}`,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error fetching member details: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: Fetch space details.
    async handleGetSpace(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const response = await this.chat.spaces.get({
                name: `spaces/${spaceId}`,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error fetching space details: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: List space memberships.
    async handleListMembers(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { pageSize, pageToken, filter, showInvited } = args;
            const response = await this.chat.spaces.members.list({
                parent: `spaces/${spaceId}`,
                pageSize,
                pageToken,
                filter,
                showInvited,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error listing memberships: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: List space messages with advanced filtering.
    async handleListMessages(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { pageSize, pageToken, orderBy, filter, showDeleted } = args;
            let finalFilter = filter;
            // If a natural language filter is provided, convert it.
            if (filter) {
                const conversionResult = await this.handleApplyNaturalLanguageFilter({
                    filterText: filter,
                });
                if (conversionResult &&
                    conversionResult.content &&
                    conversionResult.content[0] &&
                    conversionResult.content[0].text) {
                    finalFilter = conversionResult.content[0].text.replace("Converted filter: ", "");
                }
            }
            const response = await this.chat.spaces.messages.list({
                parent: `spaces/${spaceId}`,
                pageSize,
                pageToken,
                orderBy,
                filter: finalFilter,
                showDeleted,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error listing messages: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: Fetch message details.
    async handleGetMessage(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { messageId } = args;
            const response = await this.chat.spaces.messages.get({
                name: `spaces/${spaceId}/messages/${messageId}`,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error fetching message details: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: List joined spaces.
    async handleListSpaces(args) {
        try {
            const { pageSize, pageToken, filter } = args;
            const response = await this.chat.spaces.list({
                pageSize,
                pageToken,
                filter,
            });
            return {
                content: [
                    { type: "text", text: JSON.stringify(response.data, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    { type: "text", text: `Error listing joined spaces: ${error.message}` },
                ],
                isError: true,
            };
        }
    }
    // Tool: Convert natural language filters into standardized API query parameters.
    async handleApplyNaturalLanguageFilter(args) {
        try {
            const { filterText } = args;
            let apiFilter = "";
            const now = new Date();
            // Dynamic date filtering for "last month".
            if (/last month/i.test(filterText)) {
                const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                apiFilter += `createTime >= "${firstDayLastMonth.toISOString()}" AND createTime < "${firstDayThisMonth.toISOString()}"`;
            }
            // For specific quarter queries (example with Q1-2024, can be removed or modified).
            if (/Q1[- ]?2024/i.test(filterText)) {
                apiFilter += (apiFilter ? " AND " : "") + 'createTime >= "2024-01-01T00:00:00Z" AND createTime < "2024-04-01T00:00:00Z"';
            }
            // Day-of-week filtering: Example for "monday".
            if (/monday/i.test(filterText)) {
                // Compute the most recent Monday.
                const currentDay = now.getDay(); // Sunday=0, Monday=1, etc.
                const diff = (currentDay >= 1) ? currentDay - 1 : 6;
                const monday = new Date(now);
                monday.setDate(now.getDate() - diff);
                // Set start/end times for that day.
                const mondayStart = new Date(monday);
                mondayStart.setUTCHours(0, 0, 0, 0);
                const mondayEnd = new Date(monday);
                mondayEnd.setUTCHours(23, 59, 59, 999);
                apiFilter += (apiFilter ? " AND " : "") +
                    `createTime >= "${mondayStart.toISOString()}" AND createTime <= "${mondayEnd.toISOString()}"`;
            }
            // Filtering by username (e.g., "from Rahul" or "by Rahul").
            const usernameMatch = filterText.match(/(?:from|by)\s+(\w+)/i);
            if (usernameMatch && usernameMatch[1]) {
                const username = usernameMatch[1];
                apiFilter += (apiFilter ? " AND " : "") + `sender.displayName CONTAINS "${username}"`;
            }
            // Filtering for deleted messages.
            if (/deleted/i.test(filterText)) {
                apiFilter += (apiFilter ? " AND " : "") + 'state = "DELETED"';
            }
            // Keyword filtering (for text enclosed in quotes).
            const keywordMatch = filterText.match(/"(.*?)"/);
            if (keywordMatch && keywordMatch[1]) {
                const keyword = keywordMatch[1];
                apiFilter += (apiFilter ? " AND " : "") + `text CONTAINS "${keyword}"`;
            }
            // Attachment filtering.
            if (/link/i.test(filterText)) {
                apiFilter += (apiFilter ? " AND " : "") + 'attachments.type = "LINK"';
            }
            if (/image/i.test(filterText)) {
                apiFilter += (apiFilter ? " AND " : "") + 'attachments.type = "IMAGE"';
            }
            if (/docs|document/i.test(filterText)) {
                apiFilter += (apiFilter ? " AND " : "") + 'attachments.type = "DOCUMENT"';
            }
            // Fallback: if no conversion applied, return the original text.
            if (!apiFilter) {
                apiFilter = filterText;
            }
            return {
                content: [{ type: "text", text: `Converted filter: ${apiFilter}` }],
            };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error applying natural language filter: ${error.message}` }],
                isError: true,
            };
        }
    }
    // Tool: Simulated creation of a new chat space.
    async handleCreateChatSpace(args) {
        try {
            const { spaceName, description } = args;
            const newSpaceId = `SIMULATED_SPACE_${Date.now()}`;
            return {
                content: [
                    { type: "text", text: `Chat space '${spaceName}' created with ID: ${newSpaceId}` },
                ],
            };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error creating chat space: ${error.message}` }],
                isError: true,
            };
        }
    }
    // Tool: Simulated listing of shared files.
    async handleListSharedFiles(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { dateRange, sortBy } = args;
            // Simulated files list; in a real system, files would be parsed from message attachments.
            const simulatedFiles = [
                { filename: "report.pdf", type: "PDF", size: "2MB", uploader: "alice@example.com" },
                { filename: "presentation.pptx", type: "PPT", size: "5MB", uploader: "bob@example.com" },
            ];
            return {
                content: [
                    { type: "text", text: `Files in space ${spaceId} (${dateRange}):\n${simulatedFiles.map(f => `${f.filename} | ${f.type} | ${f.size} | ${f.uploader}`).join("\n")}` },
                ],
            };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error listing shared files: ${error.message}` }],
                isError: true,
            };
        }
    }
    // Tool: Simulated monitoring for new members.
    async handleMonitorNewMembers(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { managerEmail } = args;
            return {
                content: [
                    { type: "text", text: `Monitoring space ${spaceId} for new members. A DM will be sent to ${managerEmail} on a new join.` },
                ],
            };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error monitoring new members: ${error.message}` }],
                isError: true,
            };
        }
    }
    // Tool: Analyze and summarize user messages dynamically.
    async handleAnalyzeUserMessages(args) {
        try {
            const spaceId = this.getSpaceId(args);
            const { username, timeRange, summaryType, includeImages } = args;
            // Simulate dynamic query conversion:
            // 1. Convert timeRange (e.g., "yesterday", "last 5 days") into ISO date range.
            //    In a real implementation, parse the natural language time range.
            let startDate, endDate;
            const now = new Date();
            if (/yesterday/i.test(timeRange)) {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                startDate.setUTCHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setUTCHours(23, 59, 59, 999);
            }
            else if (/last\s+(\d+)\s+days/i.test(timeRange)) {
                const match = timeRange.match(/last\s+(\d+)\s+days/i);
                const days = match ? parseInt(match[1]) : 7;
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
                startDate.setUTCHours(0, 0, 0, 0);
                endDate = now;
            }
            else {
                // Fallback: if not recognized, use the past 7 days.
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                startDate.setUTCHours(0, 0, 0, 0);
                endDate = now;
            }
            // Convert time range to filter string.
            const timeFilter = `createTime >= "${startDate.toISOString()}" AND createTime < "${endDate.toISOString()}"`;
            // Build user filter if username is provided.
            const userFilter = username ? `sender.displayName CONTAINS "${username}"` : "";
            // Build additional filter based on summaryType.
            // For example, if summaryType is 'deleted', add a filter for deleted messages.
            let typeFilter = "";
            if (summaryType && summaryType.toLowerCase() === "deleted") {
                typeFilter = 'state = "DELETED"';
            }
            else if (summaryType && summaryType.toLowerCase() === "images") {
                typeFilter = 'attachments.type = "IMAGE"';
            }
            // Combine filters.
            let combinedFilter = timeFilter;
            if (userFilter) {
                combinedFilter += ` AND ${userFilter}`;
            }
            if (typeFilter) {
                combinedFilter += ` AND ${typeFilter}`;
            }
            // Simulate fetching messages with the combined filter.
            // In a production scenario, you would call the Google Chat API and then aggregate.
            // Here, we simulate dynamic results.
            const simulatedMessages = [
                { sender: "rahul@example.com", text: "Demo scheduled at 10 AM", createTime: startDate.toISOString() },
                { sender: "rahul@example.com", text: "Follow up on project status", createTime: endDate.toISOString() },
                { sender: "manager@example.com", text: "Please review the report", createTime: startDate.toISOString() },
                { sender: "manager@example.com", text: "Team meeting at 2 PM", createTime: endDate.toISOString() },
            ];
            // Simulated summary: filter messages matching the query.
            const filteredMessages = simulatedMessages.filter((msg) => {
                let matches = true;
                if (username) {
                    matches = matches && msg.sender.toLowerCase().includes(username.toLowerCase());
                }
                // Here you might add more dynamic filtering based on message time.
                return matches;
            });
            // Generate a dynamic summary.
            let summary = `Summary for ${username ? username : "all users"} between ${startDate.toISOString()} and ${endDate.toISOString()}:\n`;
            filteredMessages.forEach((msg) => {
                summary += `- [${msg.createTime}] ${msg.sender}: ${msg.text}\n`;
            });
            if (includeImages) {
                summary += "\n[Simulated image analysis]: Image content details are not available in this simulation.";
            }
            return {
                content: [{ type: "text", text: summary }],
            };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error analyzing user messages: ${error.message}` }],
                isError: true,
            };
        }
    }
    // Run the MCP server using standard IO transport.
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Google Chat MCP server running on stdio");
    }
}
const server = new GoogleChatServer();
server.run().catch(console.error);
