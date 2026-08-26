"use client";

import type { LearnerProfile as LearnerProfileType } from "@/lib/schemas/learning-path";

export function LearnerProfile({
  profile,
  onChange,
}: {
  profile: LearnerProfileType;
  onChange: (profile: LearnerProfileType) => void;
}) {
  return (
    <details className="profile-editor">
      <summary>Customize learning</summary>
      <div className="profile-grid">
        <label>
          Knowledge level
          <select
            value={profile.knowledgeLevel ?? "beginner"}
            onChange={(event) => onChange({ ...profile, knowledgeLevel: event.target.value as LearnerProfileType["knowledgeLevel"] })}
          >
            <option value="novice">Novice</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
        </label>
        <label>
          Language / vernacular
          <select
            value={profile.languageStyle ?? "standard"}
            onChange={(event) => onChange({ ...profile, languageStyle: event.target.value as LearnerProfileType["languageStyle"] })}
          >
            <option value="simple">Simple</option>
            <option value="conversational">Conversational</option>
            <option value="standard">Standard</option>
            <option value="academic">Academic</option>
            <option value="technical">Technical</option>
          </select>
        </label>
        <label>
          Depth
          <select
            value={profile.depthPreference ?? "balanced"}
            onChange={(event) => onChange({ ...profile, depthPreference: event.target.value as LearnerProfileType["depthPreference"] })}
          >
            <option value="overview">Overview</option>
            <option value="balanced">Balanced</option>
            <option value="deep">Deep</option>
          </select>
        </label>
        <label>
          Purpose
          <select
            value={profile.purpose ?? "general-learning"}
            onChange={(event) => onChange({ ...profile, purpose: event.target.value as LearnerProfileType["purpose"] })}
          >
            <option value="general-learning">General learning</option>
            <option value="class">Class</option>
            <option value="exam">Exam</option>
            <option value="research">Research</option>
            <option value="professional">Professional</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label>
          Source behavior
          <select
            value={profile.sourceMode ?? "general"}
            onChange={(event) => onChange({ ...profile, sourceMode: event.target.value as LearnerProfileType["sourceMode"] })}
          >
            <option value="general">General knowledge</option>
            <option value="prefer-uploaded">Prefer uploaded sources</option>
            <option value="uploaded-only">Uploaded sources only</option>
          </select>
        </label>
        <label className="profile-wide">
          Learning goal / context
          <input
            value={profile.learningGoal ?? ""}
            onChange={(event) => onChange({ ...profile, learningGoal: event.target.value || undefined })}
            placeholder="Optional context, e.g. understand enough linear algebra for graphics"
          />
        </label>
        <label>
          Available study time
          <input
            value={profile.availableStudyTime ?? ""}
            onChange={(event) => onChange({ ...profile, availableStudyTime: event.target.value || undefined })}
            placeholder="e.g. 4 hours/week"
          />
        </label>
        <label>
          Education level
          <input
            value={profile.educationLevel ?? ""}
            onChange={(event) => onChange({ ...profile, educationLevel: event.target.value || undefined })}
            placeholder="High school, college, self-taught…"
          />
        </label>
        <label>
          Desired field
          <input
            value={profile.desiredField ?? ""}
            onChange={(event) => onChange({ ...profile, desiredField: event.target.value || undefined })}
            placeholder="Optional"
          />
        </label>
        <label className="profile-wide">
          Preferred examples
          <input
            value={(profile.preferredExamples ?? []).join(", ")}
            onChange={(event) => onChange({
              ...profile,
              preferredExamples: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10),
            })}
            placeholder="e.g. visual, code, physics, everyday analogies"
          />
        </label>
        <label className="profile-wide">
          Preferred resources
          <input
            value={(profile.preferredResourceTypes ?? []).join(", ")}
            onChange={(event) => onChange({
              ...profile,
              preferredResourceTypes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10),
            })}
            placeholder="e.g. course, video, documentation, paper"
          />
        </label>
        <label className="profile-wide">
          Course / syllabus context
          <textarea
            value={profile.courseContext ?? ""}
            onChange={(event) => onChange({ ...profile, courseContext: event.target.value || undefined })}
            placeholder="Optional course description, syllabus topics, or exam coverage"
            rows={3}
          />
        </label>

      </div>
    </details>
  );
}
