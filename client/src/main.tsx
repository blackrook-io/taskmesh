import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { IdeaEditPage } from "./pages/IdeaEditPage.tsx";
import { IdeasListPage } from "./pages/IdeasListPage.tsx";
import { PlaygroundPage } from "./pages/PlaygroundPage.tsx";
import { ProjectDetailPage } from "./pages/ProjectDetailPage.tsx";
import { ProjectNewPage } from "./pages/ProjectNewPage.tsx";
import { ProjectsListPage } from "./pages/ProjectsListPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { TodoListsPage } from "./pages/TodoListsPage.tsx";

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
            <Route path="projects" element={<ProjectsListPage />} />
            <Route path="projects/new" element={<ProjectNewPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="todos" element={<TodoListsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="dev/playground" element={<PlaygroundPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
