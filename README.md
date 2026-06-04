# Running the Project

From the root of the project, make the script executable (only needed once):

```bash
chmod +x start.sh
```

Then start the project:

```bash
bash start.sh
# or
./start.sh
```

> **Windows users:** Ensure you are running the script from Git Bash, not 
> Command Prompt or PowerShell. Navigate to the project folder in Git Bash 
> and run `bash start.sh`.

The script will:

1. Check that Python, Node.js, and npm are installed
2. Verify your environment files exist
3. Create a Python virtual environment if one doesn't exist
4. Install backend dependencies
5. Run database migrations
6. Install frontend dependencies
7. Start both the backend and frontend servers

Once running, open your browser and go to:

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000/api

Press `Ctrl+C` to stop both servers.