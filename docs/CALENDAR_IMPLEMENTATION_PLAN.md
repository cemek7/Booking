# Calendar Implementation Plan

This document outlines the design and implementation plan for the new, interactive calendar feature.

## 1. Core Objectives

- **Visually Intuitive**: Use color-coding for staff to provide an at-a-glance understanding of schedules.
- **Informative**: Clearly display task, appointment, and staff details.
- **Flexible**: Offer Day, Week, and Month views to support different planning needs.
- **Uncluttered**: Allow `owners` and `managers` to filter the calendar to see only relevant schedules, preventing information overload.
- **Action-Oriented**: Enable the creation and management of appointments directly from the calendar.

## 2. Proposed Design

### 2.1. Main Layout: Calendar View + Sidebar

- The main UI will consist of two parts: a large calendar grid on the right and a persistent control sidebar on the left.

### 2.2. The Staff Sidebar (Filtering Control)

- This sidebar will list all staff members.
- Each staff member will be displayed with a checkbox and their assigned color swatch (e.g., `[ 🟩 Alice ]`, `[ 🟦 Bob ]`).
- `Owners` and `managers` can check or uncheck staff members to dynamically show or hide their schedules on the main calendar grid. This is the primary mechanism for managing complexity and clutter.
- The sidebar will also include an option to "View Unassigned Tasks."

### 2.3. Calendar Views

- **Month View (High-Level Overview):**
  - Displays a full monthly grid.
  - Each day cell will show a limited number of appointments (e.g., 2-3) with a `"+X more"` indicator for overflow.
  - Clicking on a day, or the "+X more" indicator, will switch the view to the **Day View** for that specific date.

- **Week View (Standard Planner):**
  - Shows a 7-day grid.
  - Appointments are rendered as colored blocks corresponding to the assigned staff member.
  - The block will display key information, such as the service name and start time.

- **Day View (The Command Center):**
  - This view is a vertical timeline for the selected day (e.g., 8 AM - 9 PM).
  - Each staff member selected in the sidebar will have their **own column**, allowing for a clear, side-by-side comparison of schedules.
  - This columnar layout is designed to provide a comprehensive view of a full day's activities without crowding the interface.

### 2.4. Interactivity

- **Clicking an Appointment**: This action will open a modal window displaying the full details of the appointment (Service, Customer, Staff Member, Duration, Status, etc.) and provide relevant action links.
- **Creating/Assigning Tasks**: `Owners` and `managers` can click on any empty time slot on the calendar. This will open a creation modal to:
  1. Select a service or task.
  2. Assign it to a staff member.
  3. Link it to a customer.
  4. Set the time and duration.
  5. Confirm the new appointment.

## 3. Technical Implementation

- A robust, third-party calendar library (e.g., `react-big-calendar`) will be used to handle the grid rendering, date navigation, and event placement.
- The calendar will be developed as a client-side, interactive component (`InteractiveCalendar.tsx`).
- Data for appointments and staff will be fetched asynchronously.
- State will be managed within the component to handle the selected view (Day, Week, Month), the currently viewed date, and the staff filter from the sidebar.
