# Inventory & Order Management API

A REST API for managing products, inventory, stock movements, and customer orders.

## Tech Stack

- Node.js
- Express.js

## Requirements

- Node.js 24
- npm

## Getting Started

Install dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

The server runs at `http://localhost:3000` by default.

## API Endpoints

### Health Check

`GET /health`

Returns the current API server status.

**Response:**

```json
{
  "status": "ok",
  "message": "Inventory Order API is running"
}
```