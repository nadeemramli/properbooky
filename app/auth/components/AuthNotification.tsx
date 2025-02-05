import { Alert } from "@/components/ui/alert";

interface AuthNotificationProps {
  type: "success" | "error" | "info";
  message: string;
}

export const AuthNotification = ({ type, message }: AuthNotificationProps) => {
  const alertStyles = {
    success: "bg-green-50 text-green-800 border-green-200",
    error: "bg-red-50 text-red-800 border-red-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
  };

  return (
    <Alert className={`${alertStyles[type]} p-4 rounded-lg mb-4`}>
      {message}
    </Alert>
  );
};
