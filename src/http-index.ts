#!/usr/bin/env node

import express from "express"
import { randomUUID } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import chalk from "chalk"
import { createFakerServer } from "./createFakerServer.js"

/**
 * HTTP-based MCP server for Faker data generation.
 * Uses StreamableHTTPServerTransport for modern MCP protocol support.
 */

const app = express()
app.use(express.json())

// Store active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {}

// Create the MCP server instance
const server = createFakerServer(
  {
    name: "faker-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

/**
 * Unified MCP endpoint supporting GET, POST, and DELETE methods.
 * Handles session initialization, message exchange, and session cleanup.
 */
app.all("/mcp", async (req, res) => {
  try {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string
    let transport: StreamableHTTPServerTransport

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport for follow-up requests
      transport = transports[sessionId]
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Create new transport for initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          console.log(chalk.green(`✓ Session initialized: ${id}`))
          transports[id] = transport
        },
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && transports[sid]) {
          console.log(chalk.yellow(`✗ Session closed: ${sid}`))
          delete transports[sid]
        }
      }

      // Connect MCP server to transport
      await server.connect(transport)
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      })
      return
    }

    // Handle the HTTP request
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error(chalk.red("Error handling MCP request:"), error)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      })
    }
  }
})

/**
 * Health check endpoint for monitoring
 */
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    activeSessions: Object.keys(transports).length,
    timestamp: new Date().toISOString(),
  })
})

/**
 * Root endpoint with service information
 */
app.get("/", (req, res) => {
  res.json({
    name: "Faker MCP Server",
    version: "0.1.0",
    description: "MCP server for generating fake data using Faker.js",
    endpoints: {
      mcp: "/mcp",
      health: "/health",
    },
    activeSessions: Object.keys(transports).length,
  })
})

/**
 * Graceful shutdown handler
 */
async function shutdown() {
  console.log(chalk.yellow("\n🛑 Shutting down server..."))

  // Close all active transports
  const sessionIds = Object.keys(transports)
  if (sessionIds.length > 0) {
    console.log(chalk.gray(`Closing ${sessionIds.length} active session(s)...`))
    for (const sessionId of sessionIds) {
      try {
        await transports[sessionId].close()
        delete transports[sessionId]
      } catch (error) {
        console.error(chalk.red(`Error closing session ${sessionId}:`), error)
      }
    }
  }

  // Close the server
  try {
    await server.close()
    console.log(chalk.green("✓ Server closed successfully"))
  } catch (error) {
    console.error(chalk.red("Error closing server:"), error)
  }

  process.exit(0)
}

// Register shutdown handlers
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// Start the Express server
const PORT = process.env.PORT || 3000
const expressServer = app.listen(PORT, () => {
  console.log(chalk.green(`✓ Faker MCP Server listening on port ${PORT}`))
  console.log(chalk.gray(`  MCP endpoint: http://localhost:${PORT}/mcp`))
  console.log(chalk.gray(`  Health check: http://localhost:${PORT}/health`))
  console.log(chalk.gray(`\nPress Ctrl+C to stop the server`))
})

// Handle server errors
expressServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(chalk.red(`✗ Port ${PORT} is already in use`))
  } else {
    console.error(chalk.red("✗ Server error:"), error)
  }
  process.exit(1)
})
