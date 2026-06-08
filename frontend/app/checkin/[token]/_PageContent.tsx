"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

interface CheckinEvent {
  event_id: number;
  title: string;
}

export default function EventCheckinPage() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params?.token[0] : params?.token;
  const [eventInfo, setEventInfo] = useState<CheckinEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const [organizationName, setOrganizationName] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState("");

  useEffect(() => {
    const loadEvent = async () => {
      if (!token) return;
      setIsLoading(true);
      try {
        const { data } = await api.get<CheckinEvent>(`/activities/checkin/${token}/`);
        if (!data) {
          throw new Error("Invalid check-in link");
        }
        setEventInfo(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load event");
      } finally {
        setIsLoading(false);
      }
    };
    loadEvent();
  }, [token]);

  const handleSubmit = async () => {
    if (!token) return;
    if (!organizationName || !participantName || !email || !contact) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    try {
      await api.post(`/activities/checkin/${token}/`, {
        organization_name: organizationName,
        name: participantName,
        email,
        contact,
      });
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to register attendance.");
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-xl">
            {eventInfo?.title || "Event Check-in"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {!isLoading && !error && !submitted && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Organization Name</Label>
                <Input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Organization"
                />
              </div>
              <div className="space-y-2">
                <Label>Participant Name</Label>
                <Input
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Gmail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Number</Label>
                <Input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
              <Button className="w-full" onClick={handleSubmit}>
                Register Attendance
              </Button>
            </div>
          )}
          {submitted && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Thank you!</p>
              <p className="text-muted-foreground">
                Your attendance has been recorded.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
