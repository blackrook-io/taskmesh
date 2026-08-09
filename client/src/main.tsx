import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { IdeaEditPage } from "./pages/IdeaEditPage.tsx";
import { IdeasListPage } from "./pages/IdeasListPage.tsx";
import { ProjectDetailPage } from "./pages/ProjectDetailPage.tsx";
import { ProjectNewPage } from "./pages/ProjectNewPage.tsx";
import { ProjectsListPage } from "./pages/ProjectsListPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { TodoListsPage } from "./pages/TodoListsPage.tsx";
import { FilesystemPage } from "./pages/FilesystemPage.tsx";
import { ImageBoardPage } from "./pages/ImageBoardPage.tsx";
import { ImageBoardEditorPage } from "./pages/ImageBoardEditorPage.tsx";
import { CalendarPage } from "./pages/CalendarPage.tsx";
import { AdminHubPage } from "./pages/AdminHubPage.tsx";
import { SettingsHubPage } from "./pages/SettingsHubPage.tsx";
import { TasksListPage } from "./pages/TasksListPage.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="ideas" element={<IdeasListPage />} />
            <Route path="ideas/:id" element={<IdeaEditPage />} />
            <Route path="tasks" element={<TasksListPage />} />
            <Route path="projects" element={<ProjectsListPage />} />
            <Route path="projects/new" element={<ProjectNewPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="todos" element={<TodoListsPage />} />
            <Route path="todos/:listId" element={<TodoListsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="filesystem" element={<FilesystemPage />} />
            <Route path="image-board" element={<ImageBoardPage />} />
            <Route path="image-board/:id" element={<ImageBoardEditorPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="settings" element={<SettingsHubPage />} />
            <Route path="settings/profile" element={<SettingsHubPage />} />
            <Route path="settings/tags" element={<SettingsHubPage />} />
            <Route path="settings/import-export" element={<SettingsHubPage />} />
            <Route path="settings/backups" element={<AdminHubPage />} />
            <Route path="settings/assistant" element={<SettingsHubPage />} />
            <Route path="admin" element={<AdminHubPage />} />
            <Route path="admin/users" element={<AdminHubPage />} />
            <Route path="admin/keys" element={<AdminHubPage />} />
            <Route path="admin/apis" element={<AdminHubPage />} />
            <Route path="admin/logging" element={<AdminHubPage />} />
            <Route path="admin/system-logs" element={<AdminHubPage />} />
            <Route path="admin/backups" element={<AdminHubPage />} />
            <Route path="admin/system-properties" element={<AdminHubPage />} />
            <Route path="admin/templates" element={<AdminHubPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
